import type { Server, Socket } from "socket.io";
import type { SocketActivityStore } from "../stores/socketActivityStore.js";

type PendingPing = {
  sentAt: number;
  serverTimestamp: string;
};

const pendingPings = new Map<string, PendingPing>();

export function registerHeartbeatHandlers(
  socket: Socket,
  activityStore: SocketActivityStore,
) {
  activityStore.touch(socket.id);

  console.log("[heartbeat] tracking socket", {
    socketId: socket.id,
    userId: socket.data.auth?.userId,
    deviceId: socket.data.auth?.deviceId,
  });

  socket.on("heartbeat:pong", () => {
    activityStore.touch(socket.id);
    pendingPings.delete(socket.id);

    console.log("[heartbeat] pong received", {
      socketId: socket.id,
      userId: socket.data.auth?.userId,
      deviceId: socket.data.auth?.deviceId,
      at: new Date().toISOString(),
    });
  });

  socket.onAny((eventName) => {
    if (eventName === "heartbeat:pong") {
      return;
    }

    activityStore.touch(socket.id);

    // Nếu client vẫn gửi event khác thì cũng chứng minh socket còn sống.
    // Vì vậy xóa pending ping để tránh disconnect nhầm.
    if (pendingPings.has(socket.id)) {
      pendingPings.delete(socket.id);

      console.log("[heartbeat] pending ping cleared by activity", {
        socketId: socket.id,
        eventName,
        at: new Date().toISOString(),
      });
    }
  });

  socket.on("disconnect", () => {
    pendingPings.delete(socket.id);
    activityStore.remove(socket.id);

    console.log("[heartbeat] socket cleanup on disconnect", {
      socketId: socket.id,
      userId: socket.data.auth?.userId,
      deviceId: socket.data.auth?.deviceId,
    });
  });
}

export function startHeartbeatCleanupInterval(
  io: Server,
  activityStore: SocketActivityStore,
  pingIntervalMs: number,
  pongTimeoutMs: number,
) {
  const interval = setInterval(() => {
    const now = Date.now();

    for (const socket of io.sockets.sockets.values()) {
      const pending = pendingPings.get(socket.id);

      if (pending) {
        const pongWaitMs = now - pending.sentAt;

        if (pongWaitMs >= pongTimeoutMs) {
          console.warn("[heartbeat] pong timeout, disconnecting socket", {
            socketId: socket.id,
            userId: socket.data.auth?.userId,
            deviceId: socket.data.auth?.deviceId,
            pongWaitMs,
            pongTimeoutMs,
            rooms: Array.from(socket.rooms),
            at: new Date().toISOString(),
          });

          pendingPings.delete(socket.id);
          activityStore.remove(socket.id);
          socket.disconnect(true);
        }

        continue;
      }

      const serverTimestamp = new Date().toISOString();

      pendingPings.set(socket.id, {
        sentAt: now,
        serverTimestamp,
      });

      socket.emit("heartbeat:ping", {
        serverTimestamp,
        pongTimeoutMs,
      });

      console.log("[heartbeat] ping sent", {
        socketId: socket.id,
        userId: socket.data.auth?.userId,
        deviceId: socket.data.auth?.deviceId,
        pongTimeoutMs,
        at: serverTimestamp,
      });
    }
  }, pingIntervalMs);

  return interval;
}