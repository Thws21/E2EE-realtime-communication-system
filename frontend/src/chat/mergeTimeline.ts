import type { CallLog, Message, TimelineItem } from "../types/index.js";

export function mergeTimeline(messages: Message[], calls: CallLog[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map((message) => ({
      type: "message" as const,
      message,
      sortAt: message.createdAt,
    })),
    ...calls.map((call) => ({
      type: "call" as const,
      call,
      sortAt: call.createdAt,
    })),
  ];
  items.sort((a, b) => a.sortAt.localeCompare(b.sortAt));
  return items;
}
