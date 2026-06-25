import type { Socket } from "socket.io";
import type { ConversationAccessService } from "../services/conversationAccess.js";
import type { CallStore } from "../stores/callStore.js";
import type { RoomSubscriptionStore } from "../stores/roomSubscriptionStore.js";
import { isUuid, readClientEvent, readRequestId } from "./events.js";
import { emitAck, emitError } from "./system.js";

type ConversationRoomPayload = {
  conversationId: string;
};

export function conversationRoomName(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function readConversationRoomPayload(payload: Record<string, unknown>): ConversationRoomPayload {
  if (!isUuid(payload.conversationId)) {
    throw new Error("VALIDATION_FAILED");
  }

  return {
    conversationId: payload.conversationId,
  };
}

export async function restoreConversationRooms(
  socket: Socket,
  accessService: ConversationAccessService,
  subscriptionStore: RoomSubscriptionStore,
) {
  const auth = socket.data.auth;

  for (const conversationId of subscriptionStore.getConversationIds(auth.userId, auth.deviceId)) {
    if (await accessService.canJoinConversation(auth.userId, conversationId)) {
      await socket.join(conversationRoomName(conversationId));
    }
  }
}

export function registerRoomHandlers(
  socket: Socket,
  accessService: ConversationAccessService,
  subscriptionStore: RoomSubscriptionStore,
  callStore: CallStore,
) {
  socket.on("conversation:join", async (data: unknown) => {
    const requestId = readRequestId(data);

    try {
      const event = readClientEvent(data, readConversationRoomPayload);
      const auth = socket.data.auth;
      const canJoin = await accessService.canJoinConversation(
        auth.userId,
        event.payload.conversationId,
      );

      if (!canJoin) {
        emitError(
          socket,
          event.requestId,
          "PERMISSION_DENIED",
          "You are not allowed to join this conversation.",
        );
        return;
      }

      const roomName = conversationRoomName(event.payload.conversationId);
      await socket.join(roomName);
      subscriptionStore.remember(auth.userId, auth.deviceId, event.payload.conversationId);

      // Peers may re-run key exchange when someone joins after init was sent.
      socket.to(roomName).emit("conversation:peer_joined", {
        conversationId: event.payload.conversationId,
        userId: auth.userId,
        deviceId: auth.deviceId,
      });

      // Re-deliver ringing call if callee joined the room after call:incoming.
      const ringingCall = callStore.getRingingCallForConversation(event.payload.conversationId);
      if (ringingCall && ringingCall.callerUserId !== auth.userId) {
        socket.emit("call:incoming", {
          callId: ringingCall.callId,
          conversationId: ringingCall.conversationId,
          callerUserId: ringingCall.callerUserId,
          callType: ringingCall.callType,
          expiresAt: ringingCall.expiresAt,
        });
      }

      emitAck(socket, event.requestId, {
        conversationId: event.payload.conversationId,
        roomName,
      });
    } catch (error) {
      emitError(
        socket,
        requestId,
        error instanceof Error && error.message === "VALIDATION_FAILED"
          ? "VALIDATION_FAILED"
          : "INTERNAL_ERROR",
        "Failed to join conversation room.",
        false,
      );
    }
  });

  socket.on("conversation:leave", async (data: unknown) => {
    const requestId = readRequestId(data);

    try {
      const event = readClientEvent(data, readConversationRoomPayload);
      const auth = socket.data.auth;
      const roomName = conversationRoomName(event.payload.conversationId);

      await socket.leave(roomName);
      subscriptionStore.forget(auth.userId, auth.deviceId, event.payload.conversationId);

      emitAck(socket, event.requestId, {
        conversationId: event.payload.conversationId,
        roomName,
      });
    } catch (error) {
      emitError(
        socket,
        requestId,
        error instanceof Error && error.message === "VALIDATION_FAILED"
          ? "VALIDATION_FAILED"
          : "INTERNAL_ERROR",
        "Failed to leave conversation room.",
        false,
      );
    }
  });
}
