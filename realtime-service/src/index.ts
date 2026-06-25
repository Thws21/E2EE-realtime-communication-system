import "dotenv/config";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "socket.io";
import { loadConfig } from "./config.js";
import { createCallPersistenceService } from "./services/callPersistence.js";
import { createConversationAccessService } from "./services/conversationAccess.js";
import { createMessagePersistenceService } from "./services/messagePersistence.js";
import { checkReadiness } from "./services/readiness.js";
import { createSocketAuthMiddleware } from "./socket/auth.js";
import { registerCallHandlers, startCallCleanupInterval } from "./socket/call.js";
import { registerChatHandlers } from "./socket/chat.js";
import { registerHeartbeatHandlers, startHeartbeatCleanupInterval } from "./socket/heartbeat.js";
import { registerKeyHandlers } from "./socket/key.js";
import { broadcastPresenceUpdate, registerPresenceHandlers } from "./socket/presence.js";
import { registerRoomHandlers, restoreConversationRooms } from "./socket/rooms.js";
import { CallStore } from "./stores/callStore.js";
import { ConnectionStore } from "./stores/connectionStore.js";
import { DedupeStore } from "./stores/dedupeStore.js";
import { KeyRotationStore } from "./stores/keyRotationStore.js";
import { NonceReplayStore } from "./stores/nonceReplayStore.js";
import { PresenceSubscriptionStore } from "./stores/presenceSubscriptionStore.js";
import { RoomSubscriptionStore } from "./stores/roomSubscriptionStore.js";
import { SocketActivityStore } from "./stores/socketActivityStore.js";

const config = loadConfig();
const connectionStore = new ConnectionStore();
const presenceSubscriptionStore = new PresenceSubscriptionStore();
const conversationAccessService = createConversationAccessService(config);
const messagePersistenceService = createMessagePersistenceService(config);
const callPersistenceService = createCallPersistenceService(config);
const dedupeStore = new DedupeStore();
const nonceReplayStore = new NonceReplayStore();
const keyRotationStore = new KeyRotationStore();
const callStore = new CallStore(config.callInviteTimeoutMs);
const roomSubscriptionStore = new RoomSubscriptionStore();
const socketActivityStore = new SocketActivityStore(
  config.socketPingIntervalMs + config.socketPingTimeoutMs,
);

function sendJson(res: ServerResponse, statusCode: number, data: Record<string, unknown>) {
  // Ham nho giup cac endpoint tra ve JSON co format giong nhau.
  const body = JSON.stringify(data);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // Healthcheck de Docker biet realtime service dang song.
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      status: "ok",
      service: "realtime-service",
    });
    return;
  }

  // Readycheck hien them cac store tam thoi de debug realtime local.
  if (req.method === "GET" && url.pathname === "/ready") {
    const readiness = await checkReadiness(config);

    sendJson(res, readiness.ready ? 200 : 503, {
      status: readiness.status,
      socketCorsOrigins: config.socketOrigins,
      authMode: config.allowDevSocketAuth ? "jwt-or-dev-token" : "jwt",
      checks: readiness.checks,
      connections: connectionStore.getStats(),
      dedupe: dedupeStore.getStats(),
      replay: nonceReplayStore.getStats(),
      keyRotation: keyRotationStore.getStats(),
      calls: callStore.getStats(),
      roomSubscriptions: roomSubscriptionStore.getStats(),
      socketActivity: socketActivityStore.getStats(),
    });
    return;
  }

  sendJson(res, 404, {
    error: "Not Found",
    path: url.pathname,
  });
});

const io = new Server(server, {
  cors: {
    origin: config.socketOrigins,
  },
  // RT-25: Cau hinh ping/pong Socket.IO de phat hien mat ket noi som hon.
  pingInterval: config.socketPingIntervalMs,
  pingTimeout: config.socketPingTimeoutMs,
});

io.use(createSocketAuthMiddleware(config));

// RT-23 va RT-25: cac interval cleanup chay o process realtime, vi state dang nam trong memory.
startCallCleanupInterval(io, callStore, callPersistenceService, config.staleCleanupIntervalMs);
startHeartbeatCleanupInterval(
  io,
  socketActivityStore,
  config.socketPingIntervalMs,
  config.socketPingTimeoutMs,
);

io.on("connection", (socket) => {
  const auth = socket.data.auth;
  const presence = connectionStore.addSocket(socket.id, auth);

  registerHeartbeatHandlers(socket, socketActivityStore);
  void restoreConversationRooms(socket, conversationAccessService, roomSubscriptionStore);
  registerRoomHandlers(socket, conversationAccessService, roomSubscriptionStore, callStore);
  registerPresenceHandlers(socket, connectionStore, presenceSubscriptionStore);
  registerChatHandlers(
    socket,
    conversationAccessService,
    messagePersistenceService,
    dedupeStore,
    nonceReplayStore,
  );
  registerKeyHandlers(socket, conversationAccessService);
  registerCallHandlers(socket, conversationAccessService, callStore, callPersistenceService);

  // Log metadata can thiet, khong log token de tranh lo thong tin nhay cam.
  console.log(
    `socket connected: socketId=${socket.id} userId=${auth.userId} deviceId=${auth.deviceId}`,
  );
  console.log(`presence changed: userId=${presence.userId} status=${presence.status}`);
  broadcastPresenceUpdate(io, presenceSubscriptionStore, presence);

  socket.on("disconnect", (reason) => {
    socketActivityStore.remove(socket.id);
    presenceSubscriptionStore.removeSocket(socket.id);
    const updatedPresence = connectionStore.removeSocket(socket.id);

    console.log(`socket disconnected: socketId=${socket.id} reason=${reason}`);
    if (updatedPresence) {
      console.log(
        `presence changed: userId=${updatedPresence.userId} status=${updatedPresence.status}`,
      );
      if (updatedPresence.status === "offline") {
        broadcastPresenceUpdate(io, presenceSubscriptionStore, updatedPresence);
      }
    }
  });
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`realtime-service listening on port ${config.port}`);
});
