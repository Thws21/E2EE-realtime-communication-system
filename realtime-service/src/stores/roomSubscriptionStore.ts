export class RoomSubscriptionStore {
  private readonly conversationIdsByDeviceKey = new Map<string, Set<string>>();

  remember(userId: string, deviceId: string, conversationId: string) {
    const key = this.createDeviceKey(userId, deviceId);
    const conversationIds = this.conversationIdsByDeviceKey.get(key) ?? new Set<string>();
    conversationIds.add(conversationId);
    this.conversationIdsByDeviceKey.set(key, conversationIds);
  }

  forget(userId: string, deviceId: string, conversationId: string) {
    const key = this.createDeviceKey(userId, deviceId);
    const conversationIds = this.conversationIdsByDeviceKey.get(key);
    conversationIds?.delete(conversationId);

    if (conversationIds?.size === 0) {
      this.conversationIdsByDeviceKey.delete(key);
    }
  }

  getConversationIds(userId: string, deviceId: string): string[] {
    return Array.from(this.conversationIdsByDeviceKey.get(this.createDeviceKey(userId, deviceId)) ?? []);
  }

  getStats() {
    let rememberedConversationCount = 0;
    for (const conversationIds of this.conversationIdsByDeviceKey.values()) {
      rememberedConversationCount += conversationIds.size;
    }

    return {
      rememberedDeviceCount: this.conversationIdsByDeviceKey.size,
      rememberedConversationCount,
    };
  }

  private createDeviceKey(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }
}
