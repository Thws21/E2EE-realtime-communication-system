import { useEffect, useRef, useState } from "react";
import { useCall } from "../context/CallContext.js";
import { useChat } from "../context/ChatContext.js";
import "./ActiveCallOverlay.css";

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function ActiveCallOverlay() {
  const {
    session,
    localStream,
    remoteStream,
    isMuted,
    isVideoEnabled,
    error,
    endCall,
    toggleMute,
    toggleVideo,
  } = useCall();
  const { conversations } = useChat();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [callDuration, setCallDuration] = useState(0);

  const visible =
    session &&
    (session.phase === "outgoing" ||
      session.phase === "connecting" ||
      session.phase === "active");

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (session?.phase !== "active") {
      setCallDuration(0);
      return;
    }
    const id = setInterval(() => setCallDuration((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, [session?.phase]);

  if (!visible || !session) return null;

  const isVideo = session.callType === "video";
  const statusLabel =
    session.phase === "outgoing"
      ? "Đang gọi..."
      : session.phase === "connecting"
        ? "Đang kết nối..."
        : "Đang trong cuộc gọi";

  let remoteName = "Cuộc gọi";
  for (const conv of conversations.values()) {
    const member = conv.members.find((m) => m.userId === session.remoteUserId);
    if (member) {
      remoteName = member.displayName;
      break;
    }
  }

  return (
    <div className={`active-call-overlay${isVideo ? " video" : ""}`}>
      <div className="active-call-content">
        {error && <div className="active-call-error">{error}</div>}

        {isVideo ? (
          <div className="active-call-videos">
            <video ref={remoteVideoRef} autoPlay playsInline className="remote-video" />
            <video ref={localVideoRef} autoPlay playsInline muted className="local-video" />
            <div className="video-call-header">
              <span className="video-call-name">{remoteName}</span>
              <span className="video-call-status">
                {session.phase === "active" ? formatDuration(callDuration) : statusLabel}
              </span>
            </div>
          </div>
        ) : (
          <div className="active-call-voice">
            <div className="voice-avatar">
              <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor" aria-hidden="true">
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
              </svg>
            </div>
            {session.phase === "active" ? (
              <span className="call-duration">{formatDuration(callDuration)}</span>
            ) : (
              <span className="voice-status">{statusLabel}</span>
            )}
            <audio ref={remoteAudioRef} autoPlay playsInline />
          </div>
        )}

        <div className="active-call-controls">
          <button
            type="button"
            className={`ctrl-btn${isMuted ? " muted" : ""}`}
            aria-label={isMuted ? "Bật mic" : "Tắt mic"}
            onClick={toggleMute}
          >
            {isMuted ? (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />
              </svg>
            )}
          </button>

          {isVideo && (
            <button
              type="button"
              className={`ctrl-btn${!isVideoEnabled ? " video-off" : ""}`}
              aria-label={isVideoEnabled ? "Tắt camera" : "Bật camera"}
              onClick={toggleVideo}
            >
              {isVideoEnabled ? (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                  <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                  <path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z" />
                </svg>
              )}
            </button>
          )}

          <button
            type="button"
            className="ctrl-btn end-call"
            aria-label="Kết thúc cuộc gọi"
            onClick={() => void endCall()}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" style={{ transform: "rotate(135deg)" }}>
              <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
