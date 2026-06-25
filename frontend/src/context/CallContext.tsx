import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CallType, IncomingCallEvent, UUID } from "../types/index.js";
import { generateUUID } from "../utils/uuid.js";
import { socketManager } from "../socket/manager.js";
import { CallPeerConnection } from "../webrtc/peerConnection.js";
import { ICE_CONNECTION_TIMEOUT_MS } from "../webrtc/config.js";
import { startRingtone, stopRingtone } from "../utils/ringtone.js";
import { useAuth } from "./AuthContext.js";

export type CallPhase = "idle" | "incoming" | "outgoing" | "connecting" | "active" | "ending";

export interface ActiveCallSession {
  callId: UUID;
  conversationId: UUID;
  callType: CallType;
  direction: "incoming" | "outgoing";
  callerUserId: UUID;
  remoteUserId: UUID;
  phase: CallPhase;
  expiresAt?: string;
}

interface CallContextValue {
  session: ActiveCallSession | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
  error: string | null;
  startCall: (conversationId: UUID, callType: CallType, remoteUserId: UUID) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
}

const CallContext = createContext<CallContextValue | undefined>(undefined);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [session, setSession] = useState<ActiveCallSession | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const peerRef = useRef<CallPeerConnection | null>(null);
  const sessionRef = useRef<ActiveCallSession | null>(null);
  const acceptedRef = useRef(false);
  const iceRestartAttemptedRef = useRef(false);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryRef = useRef<() => void>(() => {});

  const updateSession = useCallback((next: ActiveCallSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const clearConnectTimer = useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }, []);

  const armConnectTimer = useCallback(() => {
    clearConnectTimer();
    connectTimerRef.current = setTimeout(() => {
      recoveryRef.current();
    }, ICE_CONNECTION_TIMEOUT_MS);
  }, [clearConnectTimer]);

  const teardown = useCallback(() => {
    stopRingtone();
    clearConnectTimer();
    iceRestartAttemptedRef.current = false;
    acceptedRef.current = false;
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsVideoEnabled(true);
    updateSession(null);
  }, [clearConnectTimer, updateSession]);

  const ensurePeer = useCallback(
    (callType: CallType, conversationId: UUID, callId: UUID) => {
      if (peerRef.current) return peerRef.current;

      const peer = new CallPeerConnection(
        callType,
        (candidate) => {
          socketManager.sendCallIce({ callId, conversationId, candidate });
        },
        (stream) => setRemoteStream(stream),
        (state) => {
          if (state === "connected") {
            iceRestartAttemptedRef.current = false;
            clearConnectTimer();
            setSession((prev) => (prev ? { ...prev, phase: "active" } : prev));
            if (sessionRef.current) {
              sessionRef.current = { ...sessionRef.current, phase: "active" };
            }
          } else if (state === "failed") {
            recoveryRef.current();
          }
        },
      );
      peerRef.current = peer;
      return peer;
    },
    [clearConnectTimer],
  );

  const startCall = useCallback(
    async (conversationId: UUID, callType: CallType, remoteUserId: UUID) => {
      if (!user || sessionRef.current) return;
      setError(null);

      const callId = generateUUID() as UUID;
      const nextSession: ActiveCallSession = {
        callId,
        conversationId,
        callType,
        direction: "outgoing",
        callerUserId: user.userId,
        remoteUserId,
        phase: "outgoing",
      };
      updateSession(nextSession);

      try {
        await socketManager.startCall({ callId, conversationId, callType, calleeUserId: remoteUserId });
      } catch (err) {
        teardown();
        setError(err instanceof Error ? err.message : "Không thể bắt đầu cuộc gọi");
        throw err;
      }
    },
    [user, teardown, updateSession],
  );

  const acceptIncoming = useCallback(async () => {
    const current = sessionRef.current;
    if (!user || !current || current.phase !== "incoming") return;
    setError(null);

    try {
      await socketManager.acceptCall({
        callId: current.callId,
        conversationId: current.conversationId,
      });
      acceptedRef.current = true;
      const connecting: ActiveCallSession = { ...current, phase: "connecting" };
      updateSession(connecting);

      const peer = ensurePeer(current.callType, current.conversationId, current.callId);
      const stream = await peer.startLocalMedia();
      setLocalStream(stream);
      setIsVideoEnabled(current.callType === "video");
      armConnectTimer();
    } catch (err) {
      acceptedRef.current = false;
      setError(err instanceof Error ? err.message : "Không thể nhận cuộc gọi");
      updateSession({ ...current, phase: "incoming" });
      throw err;
    }
  }, [user, ensurePeer, armConnectTimer, updateSession]);

  const rejectIncoming = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    updateSession({ ...current, phase: "ending" });
    try {
      await socketManager.rejectCall({
        callId: current.callId,
        conversationId: current.conversationId,
      });
    } finally {
      teardown();
    }
  }, [teardown, updateSession]);

  const endCall = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    updateSession({ ...current, phase: "ending" });
    try {
      await socketManager.endCall({
        callId: current.callId,
        conversationId: current.conversationId,
      });
    } finally {
      teardown();
    }
  }, [teardown, updateSession]);

  const attemptRecovery = useCallback(() => {
    const current = sessionRef.current;
    if (!current || current.phase === "active") return;

    if (current.direction === "outgoing" && !iceRestartAttemptedRef.current && peerRef.current) {
      iceRestartAttemptedRef.current = true;
      peerRef.current
        .restartIce()
        .then((offer) => {
          if (!offer) return;
          void socketManager.sendCallOffer({
            callId: current.callId,
            conversationId: current.conversationId,
            sdp: offer.sdp ?? "",
            sdpType: "offer",
          });
          armConnectTimer();
        })
        .catch(() => {
          setError("Không kết nối được cuộc gọi. Hãy thử lại.");
          void endCall();
        });
    } else {
      setError("Không kết nối được cuộc gọi (mạng/NAT). Hãy thử lại.");
      void endCall();
    }
  }, [armConnectTimer, endCall]);

  useEffect(() => {
    recoveryRef.current = attemptRecovery;
  }, [attemptRecovery]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      peerRef.current?.setMuted(!prev);
      return !prev;
    });
  }, []);

  const toggleVideo = useCallback(() => {
    setIsVideoEnabled((prev) => {
      peerRef.current?.setVideoEnabled(!prev);
      return !prev;
    });
  }, []);

  const clearStaleSessionForIncoming = useCallback(
    (current: ActiveCallSession, event: IncomingCallEvent) => {
      if (current.callId === event.callId && current.phase === "incoming") {
        return false;
      }

      if (current.direction === "outgoing" && current.conversationId === event.conversationId) {
        if (user && user.userId < event.callerUserId) {
          return false;
        }
        void socketManager
          .rejectCall({ callId: current.callId, conversationId: current.conversationId })
          .catch(() => undefined);
        teardown();
        return true;
      }

      if (current.callId !== event.callId) {
        if (current.direction === "outgoing") {
          void socketManager
            .endCall({ callId: current.callId, conversationId: current.conversationId })
            .catch(() => undefined);
        }
        teardown();
        return true;
      }

      return true;
    },
    [user, teardown],
  );

  const handleIncoming = useCallback(
    (event: IncomingCallEvent) => {
      if (!user) return;

      const current = sessionRef.current;
      if (current) {
        if (current.callId === event.callId && current.phase === "incoming") {
          return;
        }
        if (!clearStaleSessionForIncoming(current, event)) {
          return;
        }
      }

      updateSession({
        callId: event.callId,
        conversationId: event.conversationId,
        callType: event.callType,
        direction: "incoming",
        callerUserId: event.callerUserId,
        remoteUserId: event.callerUserId,
        phase: "incoming",
        expiresAt: event.expiresAt,
      });
      acceptedRef.current = false;
    },
    [user, clearStaleSessionForIncoming, updateSession],
  );

  const handlersRef = useRef({
    handleIncoming,
    ensurePeer,
    teardown,
    armConnectTimer,
    updateSession,
  });
  handlersRef.current = {
    handleIncoming,
    ensurePeer,
    teardown,
    armConnectTimer,
    updateSession,
  };

  useEffect(() => {
    if (!user) return;

    const unsubIncoming = socketManager.onCallIncoming((event) => {
      handlersRef.current.handleIncoming(event);
    });

    const unsubAccept = socketManager.onCallAccept(async (payload) => {
      const current = sessionRef.current;
      if (!current || current.callId !== payload.callId) return;
      if (current.direction !== "outgoing") return;

      const connecting: ActiveCallSession = { ...current, phase: "connecting" };
      handlersRef.current.updateSession(connecting);
      try {
        const peer = handlersRef.current.ensurePeer(
          current.callType,
          current.conversationId,
          current.callId,
        );
        const stream = await peer.startLocalMedia();
        setLocalStream(stream);
        setIsVideoEnabled(current.callType === "video");
        const offer = await peer.createOffer();
        await socketManager.sendCallOffer({
          callId: current.callId,
          conversationId: current.conversationId,
          sdp: offer.sdp ?? "",
          sdpType: "offer",
        });
        handlersRef.current.armConnectTimer();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không thể thiết lập media");
        handlersRef.current.teardown();
      }
    });

    const unsubReject = socketManager.onCallReject((payload) => {
      if (sessionRef.current?.callId === payload.callId) {
        handlersRef.current.teardown();
      }
    });

    const unsubEnd = socketManager.onCallEnd((payload) => {
      if (sessionRef.current?.callId === payload.callId) {
        handlersRef.current.teardown();
      }
    });

    const unsubOffer = socketManager.onCallOffer(async (payload) => {
      const current = sessionRef.current;
      if (!current || current.callId !== payload.callId) return;
      if (current.direction !== "incoming") return;
      if (!acceptedRef.current) return;
      if (current.phase !== "connecting" && current.phase !== "active") return;

      try {
        const peer = handlersRef.current.ensurePeer(
          current.callType,
          current.conversationId,
          current.callId,
        );
        if (!peer.getLocalStream()) {
          const stream = await peer.startLocalMedia();
          setLocalStream(stream);
        }
        const answer = await peer.handleRemoteOffer({
          type: "offer",
          sdp: payload.sdp,
        });
        await socketManager.sendCallAnswer({
          callId: current.callId,
          conversationId: current.conversationId,
          sdp: answer.sdp ?? "",
          sdpType: "answer",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không thể trả lời cuộc gọi");
        handlersRef.current.teardown();
      }
    });

    const unsubAnswer = socketManager.onCallAnswer(async (payload) => {
      const current = sessionRef.current;
      if (!current || current.callId !== payload.callId) return;
      await peerRef.current?.handleRemoteAnswer({ type: "answer", sdp: payload.sdp });
      const active: ActiveCallSession = { ...current, phase: "active" };
      handlersRef.current.updateSession(active);
    });

    const unsubIce = socketManager.onCallIce(async (payload) => {
      if (sessionRef.current?.callId !== payload.callId) return;
      await peerRef.current?.addIceCandidate(payload.candidate);
    });

    return () => {
      unsubIncoming();
      unsubAccept();
      unsubReject();
      unsubEnd();
      unsubOffer();
      unsubAnswer();
      unsubIce();
    };
  }, [user?.userId]);

  useEffect(() => {
    return () => {
      teardown();
    };
  }, [teardown]);

  // Chuong theo trang thai cuoc goi: do chuong khi co cuoc den, ringback khi goi di.
  useEffect(() => {
    const phase = session?.phase;
    if (phase === "incoming") {
      startRingtone("incoming");
    } else if (phase === "outgoing" || phase === "connecting") {
      startRingtone("outgoing");
    } else {
      stopRingtone();
    }
    return () => stopRingtone();
  }, [session?.phase]);

  const value: CallContextValue = {
    session,
    localStream,
    remoteStream,
    isMuted,
    isVideoEnabled,
    error,
    startCall,
    acceptIncoming,
    rejectIncoming,
    endCall,
    toggleMute,
    toggleVideo,
  };

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) {
    throw new Error("useCall must be used within CallProvider");
  }
  return ctx;
}
