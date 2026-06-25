import type { Server, Socket } from "socket.io";
import type { ConnectionStore, PresenceStatus } from "../stores/connectionStore.js";
import type { PresenceSubscriptionStore } from "../stores/presenceSubscriptionStore.js";
import { isUuid, readClientEvent, readRequestId } from "./events.js";
import { emitAck, emitError } from "./system.js";

type PresenceSubscribePayload = {
  targets: string[];
};

function readPresenceSubscribePayload(payload: Record<string, unknown>): PresenceSubscribePayload {
  if (!Array.isArray(payload.targets) || payload.targets.length === 0) {
    throw new Error("VALIDATION_FAILED");
  }

  const targets = payload.targets.filter(isUuid);
  if (targets.length !== payload.targets.length) {
    throw new Error("VALIDATION_FAILED");
  }

  return {
    targets,
  };
}

export function registerPresenceHandlers(
  socket: Socket,
  connectionStore: ConnectionStore,
  subscriptionStore: PresenceSubscriptionStore,
) {
  socket.on("presence:subscribe", (data: unknown) => {
    const requestId = readRequestId(data);

    try {
      const event = readClientEvent(data, readPresenceSubscribePayload);

      subscriptionStore.subscribe(socket.id, event.payload.targets);

      for (const targetUserId of event.payload.targets) {
        socket.emit("presence:update", connectionStore.getPresence(targetUserId));
      }

      emitAck(socket, event.requestId, {
        targetCount: event.payload.targets.length,
      });
    } catch (error) {
      emitError(
        socket,
        requestId,
        error instanceof Error && error.message === "VALIDATION_FAILED"
          ? "VALIDATION_FAILED"
          : "INTERNAL_ERROR",
        "Failed to subscribe presence updates.",
        false,
      );
    }
  });
}

export function broadcastPresenceUpdate(
  io: Server,
  subscriptionStore: PresenceSubscriptionStore,
  presence: PresenceStatus,
) {
  for (const socketId of subscriptionStore.getSubscriberSocketIds(presence.userId)) {
    io.to(socketId).emit("presence:update", presence);
  }
}
