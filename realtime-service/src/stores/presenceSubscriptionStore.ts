export class PresenceSubscriptionStore {
  private readonly targetUserIdsBySocketId = new Map<string, Set<string>>();
  private readonly subscriberSocketIdsByTargetUserId = new Map<string, Set<string>>();

  subscribe(socketId: string, targetUserIds: string[]) {
    const currentTargets = this.targetUserIdsBySocketId.get(socketId) ?? new Set<string>();

    for (const targetUserId of targetUserIds) {
      currentTargets.add(targetUserId);

      const subscribers =
        this.subscriberSocketIdsByTargetUserId.get(targetUserId) ?? new Set<string>();
      subscribers.add(socketId);
      this.subscriberSocketIdsByTargetUserId.set(targetUserId, subscribers);
    }

    this.targetUserIdsBySocketId.set(socketId, currentTargets);
  }

  removeSocket(socketId: string) {
    const targets = this.targetUserIdsBySocketId.get(socketId);
    if (!targets) {
      return;
    }

    for (const targetUserId of targets) {
      const subscribers = this.subscriberSocketIdsByTargetUserId.get(targetUserId);
      subscribers?.delete(socketId);

      if (subscribers?.size === 0) {
        this.subscriberSocketIdsByTargetUserId.delete(targetUserId);
      }
    }

    this.targetUserIdsBySocketId.delete(socketId);
  }

  getSubscriberSocketIds(targetUserId: string): string[] {
    return Array.from(this.subscriberSocketIdsByTargetUserId.get(targetUserId) ?? []);
  }
}
