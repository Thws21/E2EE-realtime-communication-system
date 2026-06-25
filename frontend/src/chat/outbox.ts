import type { Timestamp, UUID } from "../types/index.js";

/** Pending sends waiting on socket key exchange; persisted per userId in localStorage. */
export type PendingQueueEntry = {
  clientTempId: UUID;
  plaintext: string;
  createdAt: Timestamp;
};

const OUTBOX_PREFIX = "e2ee:outbox:";

function storageKey(userId: UUID): string {
  return `${OUTBOX_PREFIX}${userId}`;
}

export function loadOutbox(userId: UUID): Map<UUID, PendingQueueEntry[]> {
  const result = new Map<UUID, PendingQueueEntry[]>();
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return result;
    const parsed = JSON.parse(raw) as Record<string, PendingQueueEntry[]>;
    for (const [conversationId, entries] of Object.entries(parsed)) {
      if (!Array.isArray(entries)) continue;
      const valid = entries.filter(
        (e): e is PendingQueueEntry =>
          !!e &&
          typeof e.clientTempId === "string" &&
          typeof e.plaintext === "string" &&
          typeof e.createdAt === "string",
      );
      if (valid.length > 0) result.set(conversationId as UUID, valid);
    }
  } catch (err) {
    console.error("Failed to load outbox:", err);
  }
  return result;
}

export function saveOutbox(userId: UUID, outbox: Map<UUID, PendingQueueEntry[]>): void {
  try {
    const obj: Record<string, PendingQueueEntry[]> = {};
    for (const [conversationId, entries] of outbox) {
      if (entries.length > 0) obj[conversationId] = entries;
    }
    if (Object.keys(obj).length === 0) {
      localStorage.removeItem(storageKey(userId));
      return;
    }
    localStorage.setItem(storageKey(userId), JSON.stringify(obj));
  } catch (err) {
    console.error("Failed to save outbox:", err);
  }
}
