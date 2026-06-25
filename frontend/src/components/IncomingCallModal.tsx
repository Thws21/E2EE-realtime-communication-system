import { useCall } from "../context/CallContext.js";
import "./IncomingCallModal.css";

interface IncomingCallModalProps {
  callerName: string;
}

export function IncomingCallModal({ callerName }: IncomingCallModalProps) {
  const { session, acceptIncoming, rejectIncoming } = useCall();

  if (!session || session.phase !== "incoming") {
    return null;
  }

  const label =
    session.callType === "video" ? "Cuộc gọi video đến" : "Cuộc gọi thoại đến";
  const initial = callerName?.[0]?.toUpperCase() ?? "?";

  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-modal">
        <div className="incoming-call-avatar-wrap">
          <span className="pulse-ring" />
          <span className="pulse-ring" />
          <div className="incoming-call-avatar">{initial}</div>
        </div>

        <p className="incoming-call-type">{label}</p>
        <h2>{callerName}</h2>
        <p className="incoming-call-sub">Đang đổ chuông...</p>

        <div className="incoming-call-actions">
          <button
            type="button"
            className="call-btn reject"
            aria-label="Từ chối"
            onClick={() => void rejectIncoming()}
          >
            <span className="call-btn-icon">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true" style={{ transform: "rotate(135deg)" }}>
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
              </svg>
            </span>
            Từ chối
          </button>

          <button
            type="button"
            className="call-btn accept"
            aria-label="Chấp nhận"
            onClick={() => void acceptIncoming()}
          >
            <span className="call-btn-icon">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
              </svg>
            </span>
            Chấp nhận
          </button>
        </div>
      </div>
    </div>
  );
}
