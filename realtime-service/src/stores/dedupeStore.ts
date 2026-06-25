import type { SocketErrorCode } from "../socket/system.js";

export type DedupeKeyInput = {
  requestId: string;
  senderDeviceId: string;
  conversationId: string;
};

export type DedupeSuccessResult = {
  type: "success";
  meta: Record<string, unknown>;
};

export type DedupeErrorResult = {
  type: "error";
  errorCode: SocketErrorCode;
  errorMessage: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type DedupeResult = DedupeSuccessResult | DedupeErrorResult;

type DedupeEntry = {
  result: DedupeResult;
  expiresAtMs: number;
};

export class DedupeStore {
  private readonly entries = new Map<string, DedupeEntry>();

  constructor(private readonly ttlMs = 5 * 60 * 1000) {}

  createKey(input: DedupeKeyInput): string {
    return `${input.requestId}:${input.senderDeviceId}:${input.conversationId}`;
  }

  get(key: string): DedupeResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAtMs <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.result;
  }

  set(key: string, result: DedupeResult) {
    this.cleanupExpired();
    this.entries.set(key, {
      result,
      expiresAtMs: Date.now() + this.ttlMs,
    });
  }

  getStats() {
    this.cleanupExpired();
    return {
      dedupeEntryCount: this.entries.size,
      dedupeTtlMs: this.ttlMs,
    };
  }

  private cleanupExpired() {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAtMs <= now) {
        this.entries.delete(key);
      }
    }
  }
}
