import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";
import { useChat } from "../context/ChatContext.js";
import { apiClient } from "../api/client.js";
import type { UUID, UserSearchResult } from "../types/index.js";
import "./ConversationSidebar.css";

function formatTime(isoString: string | undefined): string {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("vi-VN", { day: "numeric", month: "numeric" });
}

interface ConversationSidebarProps {
  activeConversationId?: string;
}

export function ConversationSidebar({ activeConversationId }: ConversationSidebarProps) {
  const navigate = useNavigate();
  const { user, logout, prekeyUploadFailed } = useAuth();
  const {
    visibleConversations,
    presences,
    setCurrentConversationId,
    loadConversations,
    subscribeToPresence,
    markConversationOpenedByMe,
    getConversationPreview,
  } = useChat();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    loadConversations().finally(() => setIsLoading(false));
  }, [loadConversations]);

  useEffect(() => {
    if (visibleConversations.length === 0 || !user) return;
    const otherIds = [
      ...new Set(
        visibleConversations.flatMap((c) =>
          c.members.filter((m) => m.userId !== user.userId).map((m) => m.userId),
        ),
      ),
    ];
    if (otherIds.length > 0) {
      void subscribeToPresence(otherIds);
    }
  }, [visibleConversations, subscribeToPresence, user]);

  const handleSearch = async (query: string) => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const result = await apiClient.searchUsers(query, 10);
      setSearchResults(result.results);
    } catch (err) {
      console.error("Search failed:", err);
    }
  };

  const handleSelectUser = async (selectedUser: UserSearchResult) => {
    setSearchQuery("");
    setSearchResults([]);
    try {
      const conversation = await apiClient.getOrCreateDirectConversation(selectedUser.userId);
      markConversationOpenedByMe(conversation.conversationId);
      await loadConversations();
      await subscribeToPresence([selectedUser.userId]);
      setCurrentConversationId(conversation.conversationId);
      navigate(`/chat/${conversation.conversationId}`);
    } catch (err) {
      console.error("Failed to create conversation:", err);
    }
  };

  const handleConversationClick = async (conversationId: UUID) => {
    const conversation = visibleConversations.find((c) => c.conversationId === conversationId);
    if (conversation) {
      await subscribeToPresence(conversation.members.map((m) => m.userId));
    }
    setCurrentConversationId(conversationId);
    navigate(`/chat/${conversationId}`);
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const getPresenceStatus = (userId: UUID) => {
    const presence = presences.get(userId);
    return presence?.status || "offline";
  };

  return (
    <div className="conversation-sidebar">
      <div className="sidebar-header">
        <div className="sidebar-user-avatar">
          {user?.displayName?.[0]?.toUpperCase() ?? "?"}
        </div>
        <h1 className="sidebar-title">Tin nhắn</h1>
        <button
          className="sidebar-logout-btn"
          onClick={handleLogout}
          aria-label="Đăng xuất"
          title="Đăng xuất"
        >
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>

      {prekeyUploadFailed && (
        <div className="sidebar-prekey-warning" role="status">
          Chưa upload khóa mã hóa — thử reload hoặc đăng nhập lại.
        </div>
      )}

      <div className="sidebar-search-section">
        <div className="search-input-wrapper">
          <span className="search-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Tìm kiếm người dùng..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              void handleSearch(e.target.value);
            }}
            className="search-input"
          />
        </div>
        {searchResults.length > 0 && (
          <div className="search-results">
            {searchResults.map((result) => (
              <button
                key={result.userId}
                className="search-result-item"
                onClick={() => void handleSelectUser(result)}
              >
                <div className="user-avatar">
                  {result.avatarUrl ? (
                    <img src={result.avatarUrl} alt={result.displayName} />
                  ) : (
                    <span>{result.displayName[0]?.toUpperCase()}</span>
                  )}
                </div>
                <div className="user-details">
                  <div className="user-display-name">{result.displayName}</div>
                  <div className="user-username">@{result.username}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="conversations-list">
        {isLoading ? (
          <div className="skeleton-list">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton-item">
                <div className="skeleton-avatar" />
                <div className="skeleton-lines">
                  <div className="skeleton-line" />
                  <div className="skeleton-line short" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleConversations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💬</div>
            <p>Chưa có cuộc trò chuyện nào.</p>
            <p>Tìm kiếm bạn bè để bắt đầu nhắn tin!</p>
          </div>
        ) : (
          visibleConversations.map((conversation) => {
            const otherMembers = conversation.members.filter(
              (m) => m.userId !== user?.userId,
            );
            const displayName =
              otherMembers.length === 1
                ? otherMembers[0].displayName
                : `${otherMembers.length} thành viên`;
            const firstOtherId = otherMembers[0]?.userId;
            const isActive = conversation.conversationId === activeConversationId;
            const preview = getConversationPreview(conversation.conversationId);

            return (
              <button
                key={conversation.conversationId}
                className={`conversation-item${isActive ? " active" : ""}${
                  conversation.unreadCount > 0 ? " unread" : ""
                }`}
                onClick={() => void handleConversationClick(conversation.conversationId)}
              >
                <div className="conversation-avatar">
                  <div className="conversation-avatar-img">
                    {otherMembers[0]?.avatarUrl ? (
                      <img src={otherMembers[0].avatarUrl} alt={displayName} />
                    ) : (
                      <span>{displayName[0]?.toUpperCase()}</span>
                    )}
                  </div>
                  <span
                    className={`status-indicator ${
                      firstOtherId ? getPresenceStatus(firstOtherId) : "offline"
                    }`}
                  />
                </div>
                <div className="conversation-info">
                  <div className="conversation-name">{displayName}</div>
                  {preview.preview && (
                    <div className="conversation-preview">{preview.preview}</div>
                  )}
                </div>
                <div className="conversation-meta">
                  {preview.sentAt && (
                    <span className="conversation-time">{formatTime(preview.sentAt)}</span>
                  )}
                  {conversation.unreadCount > 0 && (
                    <span className="unread-badge">{conversation.unreadCount}</span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
