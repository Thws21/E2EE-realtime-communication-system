import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";
import { useChat } from "../context/ChatContext.js";
import { useCall } from "../context/CallContext.js";
import { isE2eeSetupAad } from "../crypto/conversationKeys.js";
import { socketManager } from "../socket/manager.js";
import type { CallLog, CallType, Message, TimelineItem, UUID } from "../types/index.js";
import "./ChatPage.css";

function formatDuration(sec: number | null): string {
  if (sec === null || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m} phút`;
  return `${s} giây`;
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDateLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Hôm nay";
  if (date.toDateString() === yesterday.toDateString()) return "Hôm qua";
  return date.toLocaleDateString("vi-VN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function isSameDay(iso1: string, iso2: string): boolean {
  return new Date(iso1).toDateString() === new Date(iso2).toDateString();
}

function isGroupedMessage(
  current: TimelineItem,
  previous: TimelineItem | undefined,
): boolean {
  if (!previous || previous.type === "call" || current.type === "call") return false;
  if (current.message.senderUserId !== previous.message.senderUserId) return false;
  const diff =
    new Date(current.message.createdAt).getTime() -
    new Date(previous.message.createdAt).getTime();
  return diff < 2 * 60 * 1000;
}

function CallHistoryRow({
  call,
  currentUserId,
  onCallback,
}: {
  call: CallLog;
  currentUserId: UUID;
  onCallback: (callType: CallType) => void;
}) {
  const isOutgoing = call.callerId === currentUserId;
  const mediaLabel = call.callType === "video" ? "Cuộc gọi video" : "Cuộc gọi thoại";
  const direction = isOutgoing ? "đi" : "đến";

  let statusText = "";
  if (call.status === "missed") statusText = "bị nhỡ";
  else if (call.status === "rejected") statusText = "đã từ chối";
  else if (call.status === "completed") {
    const dur = formatDuration(call.durationSec);
    statusText = dur ? `· ${dur}` : "· Hoàn thành";
  } else {
    statusText = "· Kết thúc";
  }

  return (
    <div className="call-history-row">
      <div className="call-history-icon">
        {call.callType === "video" ? (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
          </svg>
        )}
      </div>
      <div className="call-history-body">
        <div className="call-history-title">
          {mediaLabel} {direction}
        </div>
        <div className="call-history-sub">{statusText}</div>
      </div>
      <button
        type="button"
        className="call-callback-btn"
        onClick={() => onCallback(call.callType)}
      >
        Gọi lại
      </button>
    </div>
  );
}

export function ChatPage() {
  const navigate = useNavigate();
  const { conversationId: conversationIdParam } = useParams<{ conversationId: string }>();
  const { user } = useAuth();
  const {
    conversations,
    timeline,
    currentConversationId,
    setCurrentConversationId,
    loadConversations,
    loadMessages,
    sendMessage,
    retryMessage,
    presences,
    subscribeToPresence,
    keyReadyConversations,
  } = useChat();
  const { startCall } = useCall();

  const [messageText, setMessageText] = useState("");
  const [error, setError] = useState("");
  const [isReconnecting, setIsReconnecting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubConnect = socketManager.onConnect(() => setIsReconnecting(false));
    const unsubDisconnect = socketManager.onDisconnect(() => setIsReconnecting(true));
    return () => {
      unsubConnect();
      unsubDisconnect();
    };
  }, []);

  const conversationId = (conversationIdParam as UUID) || currentConversationId;
  const conversation = conversationId ? conversations.get(conversationId) : null;
  const timelineItems = conversationId ? timeline.get(conversationId) || [] : [];
  const isKeyReady = conversationId ? keyReadyConversations.has(conversationId) : false;

  useEffect(() => {
    if (!conversationId) {
      navigate("/home");
      return;
    }

    setCurrentConversationId(conversationId);

    if (!conversations.get(conversationId)) {
      loadConversations();
    }

    void loadMessages(conversationId);

    return () => {
      void socketManager.leaveConversation(conversationId);
      setCurrentConversationId(null);
    };
  }, [conversationId, loadMessages]);

  useEffect(() => {
    if (!conversationId || !user) return;
    const conv = conversations.get(conversationId);
    if (!conv) return;
    const otherIds = conv.members
      .filter((m) => m.userId !== user.userId)
      .map((m) => m.userId);
    if (otherIds.length > 0) {
      void subscribeToPresence(otherIds);
    }
  }, [conversationId, conversations, subscribeToPresence, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timelineItems]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !conversationId) return;

    const text = messageText.trim();
    setMessageText("");
    setError("");

    try {
      await sendMessage(conversationId, text);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Gửi tin nhắn thất bại";
      setError(errorMsg);
    }
  };

  const handleStartCall = async (callType: CallType) => {
    if (!conversationId || !conversation || !user) return;
    const remote = conversation.members.find((m) => m.userId !== user.userId);
    if (!remote) return;
    try {
      await startCall(conversationId, callType, remote.userId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể bắt đầu cuộc gọi");
    }
  };

  if (!conversation || !user) {
    return <div className="chat-page loading">Đang tải...</div>;
  }

  const otherMembers = conversation.members.filter((m) => m.userId !== user.userId);

  function getPresenceStatus(userId: UUID): string {
    const presence = presences.get(userId);
    return presence?.status || "offline";
  }

  function renderMessageStatus(message: Message): React.ReactNode {
    if (message.outboundStatus === "pending_key") {
      return (
        <span className="message-status pending" title="Đang chờ gửi">
          <span className="send-spinner" /> Đang chờ
        </span>
      );
    }
    if (message.outboundStatus === "sending") {
      return (
        <span className="message-status pending">
          <span className="send-spinner" />
        </span>
      );
    }
    if (message.outboundStatus === "failed") {
      return (
        <button
          type="button"
          className="message-status failed"
          title="Gửi lại"
          onClick={() =>
            void retryMessage(
              conversationId as UUID,
              (message.clientTempId ?? message.messageId) as UUID,
            )
          }
        >
          ✗ Gửi lại
        </button>
      );
    }
    return (
      <span className="message-status">
        {message.readBy.length > 0 ? "✓✓" : message.deliveredTo.length > 0 ? "✓" : "○"}
      </span>
    );
  }

  function getPresenceLabel(userId: UUID): string {
    const status = getPresenceStatus(userId);
    if (status === "online") return "Đang hoạt động";
    if (status === "away") return "Vắng mặt";
    return "Ngoại tuyến";
  }

  return (
    <div className="chat-page">
      <div className="chat-header">
        <button
          className="back-button"
          onClick={() => navigate("/home")}
          aria-label="Quay lại"
        >
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div className="chat-info">
          <div className="chat-info-top">
            <h1>
              {otherMembers.length === 1
                ? otherMembers[0].displayName
                : `${otherMembers.length} thành viên`}
            </h1>
            {isKeyReady && (
              <span className="e2ee-badge" title="Mã hoá đầu cuối">
                🔒 E2EE
              </span>
            )}
          </div>
          {otherMembers.length === 1 && (
            <span className={`status ${getPresenceStatus(otherMembers[0].userId)}`}>
              {getPresenceLabel(otherMembers[0].userId)}
            </span>
          )}
        </div>

        {otherMembers.length === 1 && (
          <div className="chat-call-actions">
            <button
              type="button"
              className="call-header-btn"
              aria-label="Gọi thoại"
              onClick={() => void handleStartCall("voice")}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
              </svg>
            </button>
            <button
              type="button"
              className="call-header-btn"
              aria-label="Gọi video"
              onClick={() => void handleStartCall("video")}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="messages-container">
        {timelineItems.length === 0 ? (
          <div className="empty-messages">
            <p>Chưa có tin nhắn. Hãy bắt đầu cuộc trò chuyện!</p>
          </div>
        ) : (
          timelineItems.map((item: TimelineItem, index: number) => {
            const prevItem = index > 0 ? timelineItems[index - 1] : undefined;
            const showDateSep =
              !prevItem || !isSameDay(item.sortAt, prevItem.sortAt);
            const grouped = isGroupedMessage(item, prevItem);

            return (
              <React.Fragment
                key={
                  item.type === "call"
                    ? `call-${item.call.callId}`
                    : (item.message.clientTempId ?? item.message.messageId)
                }
              >
                {showDateSep && (
                  <div className="date-separator">
                    <span>{getDateLabel(item.sortAt)}</span>
                  </div>
                )}
                {item.type === "call" ? (
                  <CallHistoryRow
                    call={item.call}
                    currentUserId={user.userId}
                    onCallback={(callType) => void handleStartCall(callType)}
                  />
                ) : (
                  <div
                    className={`message ${
                      item.message.senderUserId === user.userId ? "sent" : "received"
                    }${grouped ? " grouped" : ""}`}
                  >
                    {item.message.senderUserId !== user.userId ? (
                      grouped ? (
                        <div className="message-avatar-placeholder" />
                      ) : (
                        <div className="message-avatar">
                          {item.message.senderAvatarUrl ? (
                            <img
                              src={item.message.senderAvatarUrl}
                              alt={item.message.senderDisplayName}
                            />
                          ) : (
                            <span>
                              {item.message.senderDisplayName?.[0]?.toUpperCase() ?? "?"}
                            </span>
                          )}
                        </div>
                      )
                    ) : null}
                    <div className="message-content">
                      {!grouped && item.message.senderUserId !== user.userId && (
                        <div className="message-sender">
                          {item.message.senderDisplayName || "Người dùng"}
                        </div>
                      )}
                      <div
                        className="message-text"
                        title={formatMessageTime(item.message.createdAt)}
                      >
                        {item.message.plaintext ? (
                          item.message.plaintext
                        ) : (
                          <span className="message-encrypted-placeholder">
                            🔒 Chưa giải mã được
                            {isE2eeSetupAad(item.message.envelope.aad) && (
                              <span className="message-decrypt-hint">
                                Có thể do đổi thiết bị/xoá dữ liệu trình duyệt.
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      {item.message.senderUserId === user.userId && (
                        <div className="message-footer">
                          <span className="message-time">
                            {formatMessageTime(item.message.createdAt)}
                          </span>
                          {renderMessageStatus(item.message)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="message-input-form" onSubmit={handleSendMessage}>
        {isReconnecting && (
          <div className="info-message reconnecting">Đang kết nối lại…</div>
        )}
        {!isReconnecting && !isKeyReady && (
          <div className="info-message">
            🔒 Đang thiết lập mã hoá — tin sẽ tự gửi khi sẵn sàng
          </div>
        )}
        {error && <div className="error-message">{error}</div>}
        <div className="input-group">
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Nhập tin nhắn..."
            className="message-input"
          />
          <button
            type="submit"
            disabled={!messageText.trim()}
            className="send-button"
            aria-label="Gửi"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
