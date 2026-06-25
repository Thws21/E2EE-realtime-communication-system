import type { Server } from "socket.io";
import type { ConnectionStore } from "../stores/connectionStore.js";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function notifyConversationCreated(
  io: Server,
  connectionStore: ConnectionStore,
  payload: {
    conversationId: string;
    peerUserId: string;
    initiatorUserId: string;
    initiatorDisplayName?: string;
  },
): number {
  if (
    !uuidRegex.test(payload.conversationId) ||
    !uuidRegex.test(payload.peerUserId) ||
    !uuidRegex.test(payload.initiatorUserId)
  ) {
    throw new Error("VALIDATION_FAILED");
  }

  const event = {
    conversationId: payload.conversationId,
    initiatorUserId: payload.initiatorUserId,
    ...(payload.initiatorDisplayName
      ? { initiatorDisplayName: payload.initiatorDisplayName }
      : {}),
  };

  let delivered = 0;
  for (const socketId of connectionStore.getUserSocketIds(payload.peerUserId)) {
    io.to(socketId).emit("conversation:created", event);
    delivered += 1;
  }
  return delivered;
}
