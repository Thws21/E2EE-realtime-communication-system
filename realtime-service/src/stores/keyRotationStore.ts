export type KeyRotationCandidate = {
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  newKeyVersion: number;
  requestId: string;
  createdAt: string;
};

export type KeyRotationDecision =
  | {
      accepted: true;
      winner: KeyRotationCandidate;
      previousWinner?: KeyRotationCandidate;
    }
  | {
      accepted: false;
      winner: KeyRotationCandidate;
    };

type KeyRotationEntry = {
  winner: KeyRotationCandidate;
  expiresAtMs: number;
};

export class KeyRotationStore {
  private readonly entriesByConversationId = new Map<string, KeyRotationEntry>();

  constructor(private readonly ttlMs = 2 * 60 * 1000) {}

  decide(candidate: KeyRotationCandidate): KeyRotationDecision {
    this.cleanupExpired();

    const existing = this.entriesByConversationId.get(candidate.conversationId);
    if (!existing) {
      this.entriesByConversationId.set(candidate.conversationId, {
        winner: candidate,
        expiresAtMs: Date.now() + this.ttlMs,
      });
      return {
        accepted: true,
        winner: candidate,
      };
    }

    const candidateWins = this.compare(candidate, existing.winner) > 0;
    if (!candidateWins) {
      return {
        accepted: false,
        winner: existing.winner,
      };
    }

    this.entriesByConversationId.set(candidate.conversationId, {
      winner: candidate,
      expiresAtMs: Date.now() + this.ttlMs,
    });

    return {
      accepted: true,
      winner: candidate,
      previousWinner: existing.winner,
    };
  }

  getStats() {
    this.cleanupExpired();
    return {
      keyRotationEntryCount: this.entriesByConversationId.size,
      keyRotationTtlMs: this.ttlMs,
    };
  }

  private compare(left: KeyRotationCandidate, right: KeyRotationCandidate): number {
    // RT-18: Version lon hon thang; neu bang nhau thi senderUserId nho hon theo alphabet thang.
    if (left.newKeyVersion !== right.newKeyVersion) {
      return left.newKeyVersion - right.newKeyVersion;
    }

    const leftUserId = left.senderUserId.toLowerCase();
    const rightUserId = right.senderUserId.toLowerCase();

    if (leftUserId === rightUserId) {
      return 0;
    }

    return leftUserId < rightUserId ? 1 : -1;
  }

  private cleanupExpired() {
    const now = Date.now();
    for (const [conversationId, entry] of this.entriesByConversationId.entries()) {
      if (entry.expiresAtMs <= now) {
        this.entriesByConversationId.delete(conversationId);
      }
    }
  }
}