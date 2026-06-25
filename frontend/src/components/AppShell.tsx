import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ConversationSidebar } from "./ConversationSidebar.js";
import { ChatPage } from "../pages/ChatPage.js";
import "./AppShell.css";

export function AppShell() {
  const { conversationId } = useParams<{ conversationId?: string }>();

  const [sidebarWidth, setSidebarWidth] = useState(
    () => Number(localStorage.getItem("sidebarWidth")) || 360,
  );
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const w = Math.max(260, Math.min(500, e.clientX));
      setSidebarWidth(w);
      localStorage.setItem("sidebarWidth", String(w));
    };
    const onUp = () => {
      isResizingRef.current = false;
      setIsResizing(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const shellClass = [
    "app-shell",
    conversationId ? "has-chat" : "",
    isResizing ? "resizing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      <div className="app-sidebar" style={{ width: sidebarWidth }}>
        <ConversationSidebar activeConversationId={conversationId} />
      </div>

      <div
        className="app-resize-handle"
        onMouseDown={() => {
          isResizingRef.current = true;
          setIsResizing(true);
        }}
      />

      <div className="app-main">
        {conversationId ? (
          <ChatPage />
        ) : (
          <div className="app-empty-state">
            <svg
              viewBox="0 0 24 24"
              width="56"
              height="56"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            <h2>Chọn cuộc trò chuyện</h2>
            <p>Chọn một cuộc trò chuyện từ danh sách để bắt đầu nhắn tin</p>
          </div>
        )}
      </div>
    </div>
  );
}
