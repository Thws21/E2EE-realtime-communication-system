export class SocketActivityStore {
  private readonly lastSeenBySocketId = new Map<string, number>();

  constructor(private readonly staleAfterMs = 90 * 1000) {}

  touch(socketId: string) {
    this.lastSeenBySocketId.set(socketId, Date.now());
  }

  remove(socketId: string) {
    this.lastSeenBySocketId.delete(socketId);
  }

  findStaleSocketIds(): string[] {
    const now = Date.now();
    const staleSocketIds: string[] = [];

    for (const [socketId, lastSeenAtMs] of this.lastSeenBySocketId.entries()) {
      if (now - lastSeenAtMs > this.staleAfterMs) {
        staleSocketIds.push(socketId);
      }
    }

    return staleSocketIds;
  }

  getStats() {
    return {
      trackedSocketCount: this.lastSeenBySocketId.size,
      staleAfterMs: this.staleAfterMs,
    };
  }
}
