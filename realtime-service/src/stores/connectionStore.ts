import type { AuthContext } from "../socket/auth.js";

export type ConnectionRecord = AuthContext & {
  socketId: string;
  connectedAt: string;
};

export type PresenceStatus = {
  userId: string;
  status: "online" | "offline";
  lastSeenAt?: string;
};

export class ConnectionStore {
  private readonly socketsById = new Map<string, ConnectionRecord>();
  private readonly socketIdsByUserId = new Map<string, Set<string>>();
  private readonly lastSeenByUserId = new Map<string, string>();

  addSocket(socketId: string, auth: AuthContext): PresenceStatus {
    const connectedAt = new Date().toISOString();
    const existingSockets = this.socketIdsByUserId.get(auth.userId) ?? new Set<string>();

    this.socketsById.set(socketId, {
      ...auth,
      socketId,
      connectedAt,
    });
    existingSockets.add(socketId);
    this.socketIdsByUserId.set(auth.userId, existingSockets);

    return {
      userId: auth.userId,
      status: "online",
    };
  }

  removeSocket(socketId: string): PresenceStatus | null {
    const record = this.socketsById.get(socketId);
    if (!record) {
      return null;
    }

    this.socketsById.delete(socketId);

    const userSockets = this.socketIdsByUserId.get(record.userId);
    userSockets?.delete(socketId);

    if (userSockets && userSockets.size > 0) {
      return {
        userId: record.userId,
        status: "online",
      };
    }

    const lastSeenAt = new Date().toISOString();
    this.socketIdsByUserId.delete(record.userId);
    this.lastSeenByUserId.set(record.userId, lastSeenAt);

    return {
      userId: record.userId,
      status: "offline",
      lastSeenAt,
    };
  }

  getSocket(socketId: string): ConnectionRecord | undefined {
    return this.socketsById.get(socketId);
  }

  getUserSocketIds(userId: string): string[] {
    return Array.from(this.socketIdsByUserId.get(userId) ?? []);
  }

  getPresence(userId: string): PresenceStatus {
    const socketIds = this.socketIdsByUserId.get(userId);
    if (socketIds && socketIds.size > 0) {
      return {
        userId,
        status: "online",
      };
    }

    const lastSeenAt = this.lastSeenByUserId.get(userId);
    return lastSeenAt
      ? {
          userId,
          status: "offline",
          lastSeenAt,
        }
      : {
          userId,
          status: "offline",
        };
  }

  getStats() {
    return {
      socketCount: this.socketsById.size,
      onlineUserCount: this.socketIdsByUserId.size,
    };
  }
}
