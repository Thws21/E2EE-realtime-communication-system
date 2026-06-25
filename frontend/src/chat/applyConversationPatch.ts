import type { CallLog, Message, TimelineItem, UUID } from "../types/index.js";
import { mergeTimeline } from "./mergeTimeline.js";

export type ConversationMaps = {
  messages: Map<UUID, Message[]>;
  calls: Map<UUID, CallLog[]>;
  timeline: Map<UUID, TimelineItem[]>;
};

export function applyConversationPatch(
  maps: ConversationMaps,
  conversationId: UUID,
  patch: { messages?: Message[]; calls?: CallLog[] },
): ConversationMaps {
  const nextMessages = new Map(maps.messages);
  const nextCalls = new Map(maps.calls);
  const nextTimeline = new Map(maps.timeline);

  const messages = patch.messages ?? maps.messages.get(conversationId) ?? [];
  const calls = patch.calls ?? maps.calls.get(conversationId) ?? [];

  if (patch.messages !== undefined) {
    nextMessages.set(conversationId, messages);
  }
  if (patch.calls !== undefined) {
    nextCalls.set(conversationId, calls);
  }
  nextTimeline.set(conversationId, mergeTimeline(messages, calls));

  return {
    messages: nextMessages,
    calls: nextCalls,
    timeline: nextTimeline,
  };
}

export function patchMessageInConversation(
  messages: Message[],
  clientTempId: UUID,
  updater: (message: Message) => Message,
): Message[] {
  return messages.map((m) =>
    m.clientTempId === clientTempId || m.messageId === clientTempId ? updater(m) : m,
  );
}
