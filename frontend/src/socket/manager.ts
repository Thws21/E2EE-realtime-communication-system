import { io, type Socket } from "socket.io-client";
import type { UUID, Message, Presence, IncomingCallEvent, CallLog } from "../types/index.js";

const SOCKET_URL = import.meta.env.VITE_SOCKET_BASE_URL || "";
console.log("[Socket] SOCKET_URL:", SOCKET_URL || "(same origin — relies on nginx /socket.io/ proxy)");

type PresenceUpdateListener = (presence: Presence) => void;
type ChatMessageListener = (message: Message) => void;
type SystemAckListener = (requestId: UUID, meta?: Record<string, unknown>) => void;
type SystemErrorListener = (
  requestId: UUID,
  errorCode: string,
  errorMessage: string,
  retryable: boolean,
) => void;
type CallIncomingListener = (call: IncomingCallEvent) => void;

export type CallRelayPayload = {
  callId: UUID;
  conversationId: UUID;
  senderUserId?: UUID;
  senderDeviceId?: UUID;
  reason?: string;
};

export type CallSdpPayload = {
  callId: UUID;
  conversationId: UUID;
  sdp: string;
  sdpType: "offer" | "answer";
  senderUserId?: UUID;
};

export type CallIceRelayPayload = {
  callId: UUID;
  conversationId: UUID;
  candidate: RTCIceCandidateInit;
  senderUserId?: UUID;
};

type CallRelayListener = (payload: CallRelayPayload) => void;
type CallSdpListener = (payload: CallSdpPayload) => void;
type CallIceListener = (payload: CallIceRelayPayload) => void;
type CallLoggedListener = (call: CallLog) => void;

export type KeyExchangeInitEvent = {
  conversationId: UUID;
  sessionProposalId: UUID;
  curve: "p256" | "x25519";
  publicKey: string;
  senderUserId: UUID;
  senderDeviceId: UUID;
};

export type KeyExchangeResponseEvent = {
  conversationId: UUID;
  sessionProposalId: UUID;
  publicKey: string;
  accepted: boolean;
  senderUserId: UUID;
};

export type PeerJoinedEvent = {
  conversationId: UUID;
  userId: UUID;
  deviceId: UUID;
};

export type MessageReceiptEvent = {
  conversationId: UUID;
  messageIds: UUID[];
  userId: UUID;
  status: "delivered" | "read";
};

type KeyExchangeInitListener = (event: KeyExchangeInitEvent) => void;
type KeyExchangeResponseListener = (event: KeyExchangeResponseEvent) => void;
type PeerJoinedListener = (event: PeerJoinedEvent) => void;
type MessageReceiptListener = (event: MessageReceiptEvent) => void;

export type ConversationCreatedEvent = {
  conversationId: UUID;
  initiatorUserId: UUID;
  initiatorDisplayName?: string;
};

type ConversationCreatedListener = (event: ConversationCreatedEvent) => void;

type RawChatMessage = {
  messageId: UUID;
  conversationId: UUID;
  senderUserId: UUID;
  senderDeviceId: UUID;
  ciphertext: string;
  nonce: string;
  algorithm: "aes-256-gcm";
  keyVersion: number;
  aad?: Record<string, unknown>;
  createdAt: string;
};

export type PendingKeyExchange = {
  privateKey: CryptoKey;
  conversationId: UUID;
};

export class SocketManager {
  private socket: Socket | null = null;
  private listeners = {
    presenceUpdate: new Set<PresenceUpdateListener>(),
    chatMessage: new Set<ChatMessageListener>(),
    systemAck: new Set<SystemAckListener>(),
    systemError: new Set<SystemErrorListener>(),
    callIncoming: new Set<CallIncomingListener>(),
    callAccept: new Set<CallRelayListener>(),
    callReject: new Set<CallRelayListener>(),
    callEnd: new Set<CallRelayListener>(),
    callOffer: new Set<CallSdpListener>(),
    callAnswer: new Set<CallSdpListener>(),
    callIce: new Set<CallIceListener>(),
    callLogged: new Set<CallLoggedListener>(),
    keyExchangeInit: new Set<KeyExchangeInitListener>(),
    keyExchangeResponse: new Set<KeyExchangeResponseListener>(),
    peerJoined: new Set<PeerJoinedListener>(),
    conversationCreated: new Set<ConversationCreatedListener>(),
    messageReceipt: new Set<MessageReceiptListener>(),
  };

  readonly pendingKeyExchanges: Map<string, PendingKeyExchange> = new Map();

  private joinedConversations = new Set<UUID>();
  private presenceTargets = new Set<UUID>();
  private connectListeners = new Set<() => void>();
  private disconnectListeners = new Set<() => void>();

  connect(accessToken: string): Promise<void> {
    if (this.socket?.connected) return Promise.resolve();

    if (this.socket) {
      return new Promise<void>((resolve) => {
        this.socket!.once("connect", resolve);
      });
    }

    return new Promise<void>((resolve) => {
      this.socket = io(SOCKET_URL, {
        auth: { accessToken },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
      });

      this.setupEventListeners();

      this.socket.on("connect", () => {
        console.log("[Socket] Connected to realtime service");
        resolve();
        this.resubscribe();
        this.connectListeners.forEach((l) => l());
      });

      this.socket.on("connect_error", (error) => {
        console.warn("[Socket] Connection error (will retry):", error.message);
      });

      this.socket.on("disconnect", (reason) => {
        console.log("[Socket] Disconnected:", reason);
        this.disconnectListeners.forEach((l) => l());
      });

      this.socket.on("reconnect", (attempt) => {
        console.log("[Socket] Reconnected after", attempt, "attempt(s)");
      });
    });
  }

  disconnect() {
    this.joinedConversations.clear();
    this.presenceTargets.clear();
    this.pendingKeyExchanges.clear();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  reconnectWithToken(accessToken: string): Promise<void> {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    return this.connect(accessToken);
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  private setupEventListeners() {
    if (!this.socket) return;

    this.socket.on("heartbeat:ping", () => {
      this.socket?.emit("heartbeat:pong");
    });

    this.socket.on("presence:update", (presence: Presence) => {
      this.listeners.presenceUpdate.forEach((l) => l(presence));
    });

    this.socket.on("chat:message", (raw: RawChatMessage) => {
      const message: Message = {
        messageId: raw.messageId,
        conversationId: raw.conversationId,
        senderUserId: raw.senderUserId,
        senderUsername: "",
        senderDisplayName: "",
        senderAvatarUrl: undefined,
        envelope: {
          ciphertext: raw.ciphertext,
          nonce: raw.nonce,
          algorithm: raw.algorithm,
          keyVersion: raw.keyVersion,
          ...(raw.aad ? { aad: raw.aad } : {}),
          clientMessageSeq: 0,
        },
        deliveredTo: [],
        readBy: [],
        createdAt: raw.createdAt as Message["createdAt"],
      };
      this.listeners.chatMessage.forEach((l) => l(message));
    });

    this.socket.on(
      "system:ack",
      (data: { requestId: UUID; status: string; meta?: Record<string, unknown> }) => {
        this.listeners.systemAck.forEach((l) => l(data.requestId, data.meta));
      },
    );

    this.socket.on(
      "system:error",
      (data: { requestId: UUID; errorCode: string; errorMessage: string; retryable: boolean }) => {
        this.listeners.systemError.forEach((l) =>
          l(data.requestId, data.errorCode, data.errorMessage, data.retryable),
        );
      },
    );

    this.socket.on("call:incoming", (raw: IncomingCallEvent) => {
      this.listeners.callIncoming.forEach((l) => l(raw));
    });

    this.socket.on("call:accept", (payload: CallRelayPayload) => {
      this.listeners.callAccept.forEach((l) => l(payload));
    });

    this.socket.on("call:reject", (payload: CallRelayPayload) => {
      this.listeners.callReject.forEach((l) => l(payload));
    });

    this.socket.on("call:end", (payload: CallRelayPayload) => {
      this.listeners.callEnd.forEach((l) => l(payload));
    });

    this.socket.on("call:offer", (payload: CallSdpPayload) => {
      this.listeners.callOffer.forEach((l) => l(payload));
    });

    this.socket.on("call:answer", (payload: CallSdpPayload) => {
      this.listeners.callAnswer.forEach((l) => l(payload));
    });

    this.socket.on("call:ice", (payload: CallIceRelayPayload) => {
      this.listeners.callIce.forEach((l) => l(payload));
    });

    this.socket.on(
      "call:logged",
      (payload: {
        callId: UUID;
        conversationId: UUID;
        callerId: UUID;
        callType: CallLog["callType"];
        status: CallLog["status"];
        startedAt: string | null;
        endedAt: string | null;
        durationSec: number | null;
        createdAt: string;
      }) => {
        const call: CallLog = {
          callId: payload.callId,
          conversationId: payload.conversationId,
          callerId: payload.callerId,
          receiverId: "" as UUID,
          callType: payload.callType,
          status: payload.status,
          startedAt: payload.startedAt as CallLog["startedAt"],
          endedAt: payload.endedAt as CallLog["endedAt"],
          durationSec: payload.durationSec,
          createdAt: payload.createdAt as CallLog["createdAt"],
        };
        this.listeners.callLogged.forEach((l) => l(call));
      },
    );

    this.socket.on("key:exchange:init", (payload: KeyExchangeInitEvent) => {
      this.listeners.keyExchangeInit.forEach((l) => l(payload));
    });

    this.socket.on("key:exchange:response", (payload: KeyExchangeResponseEvent) => {
      this.listeners.keyExchangeResponse.forEach((l) => l(payload));
    });

    this.socket.on("conversation:peer_joined", (payload: PeerJoinedEvent) => {
      this.listeners.peerJoined.forEach((l) => l(payload));
    });

    this.socket.on("conversation:created", (payload: ConversationCreatedEvent) => {
      this.listeners.conversationCreated.forEach((l) => l(payload));
    });

    this.socket.on("message:receipt", (payload: MessageReceiptEvent) => {
      this.listeners.messageReceipt.forEach((l) => l(payload));
    });
  }

  private resubscribe() {
    const conversationIds = [...this.joinedConversations];
    const presenceTargets = [...this.presenceTargets];
    if (conversationIds.length === 0 && presenceTargets.length === 0) return;
    this.emitEvent("realtime:resubscribe", { conversationIds, presenceTargets });
  }

  private emitEvent<T>(event: string, payload: T): UUID {
    const requestId = this.generateUUID() as UUID;
    this.socket?.emit(event, {
      requestId,
      timestamp: new Date().toISOString(),
      payload,
    });
    return requestId;
  }

  private generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  joinConversation(conversationId: UUID): Promise<UUID> {
    this.joinedConversations.add(conversationId);
    return new Promise((resolve, reject) => {
      const requestId = this.emitEvent("conversation:join", { conversationId });
      console.log("[Socket] joinConversation emit, requestId:", requestId, "conv:", conversationId);

      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.systemAck.delete(onAck);
        this.listeners.systemError.delete(onErr);
      };

      const timer = setTimeout(() => {
        cleanup();
        console.warn("[Socket] joinConversation ack timed out — proceeding anyway:", conversationId);
        resolve(requestId);
      }, 5000);

      const onAck = (id: UUID) => {
        if (id !== requestId) return;
        cleanup();
        console.log("[Socket] joinConversation ack received:", conversationId);
        resolve(requestId);
      };
      const onErr = (id: UUID, code: string, msg: string) => {
        if (id !== requestId) return;
        cleanup();
        console.error("[Socket] joinConversation error:", code, msg);
        reject(new Error(`${code}: ${msg}`));
      };
      this.listeners.systemAck.add(onAck);
      this.listeners.systemError.add(onErr);
    });
  }

  leaveConversation(conversationId: UUID): Promise<UUID> {
    this.joinedConversations.delete(conversationId);
    return new Promise((resolve, reject) => {
      const requestId = this.emitEvent("conversation:leave", { conversationId });

      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.systemAck.delete(onAck);
        this.listeners.systemError.delete(onErr);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(requestId);
      }, 3000);

      const onAck = (id: UUID) => {
        if (id !== requestId) return;
        cleanup();
        resolve(requestId);
      };
      const onErr = (id: UUID, code: string, msg: string) => {
        if (id !== requestId) return;
        cleanup();
        reject(new Error(`${code}: ${msg}`));
      };
      this.listeners.systemAck.add(onAck);
      this.listeners.systemError.add(onErr);
    });
  }

  subscribePresence(targets: UUID[]): Promise<void> {
    targets.forEach((id) => this.presenceTargets.add(id));
    return new Promise((resolve, reject) => {
      const requestId = this.emitEvent("presence:subscribe", { targets });
      const onAck = (id: UUID) => {
        if (id !== requestId) return;
        this.listeners.systemAck.delete(onAck);
        this.listeners.systemError.delete(onErr);
        resolve();
      };
      const onErr = (id: UUID, code: string, msg: string) => {
        if (id !== requestId) return;
        this.listeners.systemAck.delete(onAck);
        this.listeners.systemError.delete(onErr);
        reject(new Error(`${code}: ${msg}`));
      };
      this.listeners.systemAck.add(onAck);
      this.listeners.systemError.add(onErr);
    });
  }

  sendMessage(payload: {
    conversationId: UUID;
    messageId: UUID;
    ciphertext: string;
    nonce: string;
    algorithm: "aes-256-gcm";
    keyVersion: number;
    aad?: Record<string, unknown>;
    clientMessageSeq: number;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestId = this.emitEvent("chat:send", payload);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.systemAck.delete(onAck);
        this.listeners.systemError.delete(onErr);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("TIMEOUT: no ack from server"));
      }, 10000);
      const onAck = (id: UUID) => {
        if (id !== requestId) return;
        cleanup();
        resolve();
      };
      const onErr = (id: UUID, code: string, msg: string) => {
        if (id !== requestId) return;
        cleanup();
        reject(new Error(`${code}: ${msg}`));
      };
      this.listeners.systemAck.add(onAck);
      this.listeners.systemError.add(onErr);
    });
  }

  markDelivered(conversationId: UUID, messageId: UUID): void {
    this.emitEvent("chat:delivered", { conversationId, messageId });
  }

  markRead(conversationId: UUID, messageIds: UUID[]): void {
    this.emitEvent("chat:read", { conversationId, messageIds });
  }

  initiateKeyExchange(
    conversationId: UUID,
    sessionProposalId: UUID,
    publicKeyBase64: string,
  ): UUID {
    return this.emitEvent("key:exchange:init", {
      conversationId,
      sessionProposalId,
      curve: "p256",
      publicKey: publicKeyBase64,
    });
  }

  respondToKeyExchange(
    conversationId: UUID,
    sessionProposalId: UUID,
    publicKeyBase64: string,
  ): UUID {
    return this.emitEvent("key:exchange:response", {
      conversationId,
      sessionProposalId,
      publicKey: publicKeyBase64,
      accepted: true,
    });
  }

  onKeyExchangeInit(listener: KeyExchangeInitListener): () => void {
    this.listeners.keyExchangeInit.add(listener);
    return () => this.listeners.keyExchangeInit.delete(listener);
  }

  onKeyExchangeResponse(listener: KeyExchangeResponseListener): () => void {
    this.listeners.keyExchangeResponse.add(listener);
    return () => this.listeners.keyExchangeResponse.delete(listener);
  }

  onPeerJoined(listener: PeerJoinedListener): () => void {
    this.listeners.peerJoined.add(listener);
    return () => this.listeners.peerJoined.delete(listener);
  }

  onMessageReceipt(listener: MessageReceiptListener): () => void {
    this.listeners.messageReceipt.add(listener);
    return () => this.listeners.messageReceipt.delete(listener);
  }

  onConnect(listener: () => void): () => void {
    this.connectListeners.add(listener);
    if (this.socket?.connected) listener();
    return () => this.connectListeners.delete(listener);
  }

  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  // Cap nhat token cho lan auto-reconnect ke tiep (network blip) ma khong tao socket moi.
  updateAuthToken(accessToken: string): void {
    if (this.socket) {
      this.socket.auth = { accessToken };
    }
  }

  getPendingExchangeForConversation(conversationId: UUID): { sessionProposalId: UUID } | null {
    for (const [sessionProposalId, pending] of this.pendingKeyExchanges) {
      if (pending.conversationId === conversationId) {
        return { sessionProposalId: sessionProposalId as UUID };
      }
    }
    return null;
  }

  onPresenceUpdate(listener: PresenceUpdateListener) {
    this.listeners.presenceUpdate.add(listener);
    return () => this.listeners.presenceUpdate.delete(listener);
  }

  onChatMessage(listener: ChatMessageListener) {
    this.listeners.chatMessage.add(listener);
    return () => this.listeners.chatMessage.delete(listener);
  }

  private emitCallEvent<T>(event: string, payload: T): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestId = this.emitEvent(event, payload);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.systemAck.delete(onAck);
        this.listeners.systemError.delete(onErr);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("TIMEOUT: no ack from server"));
      }, 10000);
      const onAck = (id: UUID) => {
        if (id !== requestId) return;
        cleanup();
        resolve();
      };
      const onErr = (id: UUID, code: string, msg: string) => {
        if (id !== requestId) return;
        cleanup();
        reject(new Error(`${code}: ${msg}`));
      };
      this.listeners.systemAck.add(onAck);
      this.listeners.systemError.add(onErr);
    });
  }

  startCall(payload: {
    callId: UUID;
    conversationId: UUID;
    callType: "voice" | "video";
    calleeUserId: UUID;
  }): Promise<void> {
    return this.emitCallEvent("call:start", payload);
  }

  acceptCall(payload: { callId: UUID; conversationId: UUID }): Promise<void> {
    return this.emitCallEvent("call:accept", payload);
  }

  rejectCall(payload: { callId: UUID; conversationId: UUID }): Promise<void> {
    return this.emitCallEvent("call:reject", payload);
  }

  endCall(payload: { callId: UUID; conversationId: UUID }): Promise<void> {
    return this.emitCallEvent("call:end", payload);
  }

  sendCallOffer(payload: {
    callId: UUID;
    conversationId: UUID;
    sdp: string;
    sdpType: "offer";
  }): Promise<void> {
    return this.emitCallEvent("call:offer", payload);
  }

  sendCallAnswer(payload: {
    callId: UUID;
    conversationId: UUID;
    sdp: string;
    sdpType: "answer";
  }): Promise<void> {
    return this.emitCallEvent("call:answer", payload);
  }

  sendCallIce(payload: {
    callId: UUID;
    conversationId: UUID;
    candidate: RTCIceCandidateInit;
  }): void {
    this.emitEvent("call:ice", payload);
  }

  onCallIncoming(listener: CallIncomingListener) {
    this.listeners.callIncoming.add(listener);
    return () => this.listeners.callIncoming.delete(listener);
  }

  onCallAccept(listener: CallRelayListener) {
    this.listeners.callAccept.add(listener);
    return () => this.listeners.callAccept.delete(listener);
  }

  onCallReject(listener: CallRelayListener) {
    this.listeners.callReject.add(listener);
    return () => this.listeners.callReject.delete(listener);
  }

  onCallEnd(listener: CallRelayListener) {
    this.listeners.callEnd.add(listener);
    return () => this.listeners.callEnd.delete(listener);
  }

  onCallOffer(listener: CallSdpListener) {
    this.listeners.callOffer.add(listener);
    return () => this.listeners.callOffer.delete(listener);
  }

  onCallAnswer(listener: CallSdpListener) {
    this.listeners.callAnswer.add(listener);
    return () => this.listeners.callAnswer.delete(listener);
  }

  onCallIce(listener: CallIceListener) {
    this.listeners.callIce.add(listener);
    return () => this.listeners.callIce.delete(listener);
  }

  onCallLogged(listener: CallLoggedListener) {
    this.listeners.callLogged.add(listener);
    return () => this.listeners.callLogged.delete(listener);
  }

  onConversationCreated(listener: ConversationCreatedListener) {
    this.listeners.conversationCreated.add(listener);
    return () => this.listeners.conversationCreated.delete(listener);
  }
}

export const socketManager = new SocketManager();
