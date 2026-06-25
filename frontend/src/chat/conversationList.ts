import type { Conversation, ConversationLocalMeta, Timestamp, UUID } from "../types/index.js";

const PREVIEW_MAX_LEN = 40;

export function truncatePreview(text: string): string {
  if (text.length <= PREVIEW_MAX_LEN) return text;
  return `${text.slice(0, PREVIEW_MAX_LEN - 1)}…`;
}

export function shouldShowInList(
  conversation: Conversation,
  meta: ConversationLocalMeta | undefined,
): boolean {
  if (conversation.lastMessagePreview) return true;
  if (meta?.hasLocalActivity) return true;
  if (meta?.openedByMe) return true;
  return false;
}

export function getSortKey(
  conversation: Conversation,
  meta: ConversationLocalMeta | undefined,
): string {
  const candidates = [
    meta?.lastActivityAt,
    conversation.lastMessagePreview?.sentAt,
    conversation.updatedAt,
    conversation.createdAt,
  ].filter(Boolean) as string[];
  return candidates.sort().at(-1) ?? conversation.createdAt;
}

export function buildPreviewText(
  conversation: Conversation,
  meta: ConversationLocalMeta | undefined,
): { preview?: string; sentAt?: Timestamp } {
  if (meta?.lastPreview) {
    return {
      preview: truncatePreview(meta.lastPreview),
      sentAt: meta.lastActivityAt,
    };
  }
  if (conversation.lastMessagePreview) {
    return {
      preview: conversation.lastMessagePreview.preview ?? "🔒 Đã mã hoá",
      sentAt: conversation.lastMessagePreview.sentAt,
    };
  }
  return {};
}

export function getSortedVisibleConversations(
  conversations: Map<UUID, Conversation>,
  localMeta: Map<UUID, ConversationLocalMeta>,
): Conversation[] {
  return Array.from(conversations.values())
    .filter((conv) => shouldShowInList(conv, localMeta.get(conv.conversationId)))
    .sort((a, b) => {
      const keyA = getSortKey(a, localMeta.get(a.conversationId));
      const keyB = getSortKey(b, localMeta.get(b.conversationId));
      return keyB.localeCompare(keyA);
    });
}
