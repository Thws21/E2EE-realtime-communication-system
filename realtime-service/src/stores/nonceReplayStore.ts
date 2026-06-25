export type NonceReplayInput = {
  senderDeviceId: string;
  conversationId: string;
  nonce: string;
  keyVersion: number;
};

type NonceReplayEntry = {
  expiresAtMs: number;
};

export class NonceReplayStore {
  private readonly entries = new Map<string, NonceReplayEntry>();

  constructor(private readonly ttlMs = 60 * 60 * 1000) {}

  createKey(input: NonceReplayInput): string {
    return `${input.senderDeviceId}:${input.conversationId}:${input.nonce}:${input.keyVersion}`;
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }

    if (entry.expiresAtMs <= Date.now()) {
      this.entries.delete(key);
      return false;
    }

    return true;
  }

  markUsed(key: string) {
    // Mark only after persist succeeds so network retries are not blocked.
    this.cleanupExpired();
    this.entries.set(key, {
      expiresAtMs: Date.now() + this.ttlMs,
    });
  }

  getStats() {
    this.cleanupExpired();
    return {
      nonceReplayEntryCount: this.entries.size,
      nonceReplayTtlMs: this.ttlMs,
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
