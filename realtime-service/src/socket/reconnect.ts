import type { Socket } from "socket.io";
import type { ConversationAccessService } from "../services/conversationAccess.js";
import type { ConnectionStore } from "../stores/connectionStore.js";
import type { PresenceSubscriptionStore } from "../stores/presenceSubscriptionStore.js";
import type { RoomSubscriptionStore } from "../stores/roomSubscriptionStore.js";
import { isUuid, readClientEvent, readRequestId } from "./events.js";
import { conversationRoomName } from "./rooms.js";
import { emitAck, emitError } from "./system.js";

type RealtimeResubscribePayload = {
  conversationIds: string[];
  presenceTargets: string[];
};

function readUuidArray(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.some((item) => !isUuid(item))) {
    throw new Error("VALIDATION_FAILED");
  }

  return value;
}

function readRealtimeResubscribePayload(
  payload: Record<string, unknown>,
): RealtimeResubscribePayload {
  return {
    conversationIds: readUuidArray(payload.conversationIds),
    presenceTargets: readUuidArray(payload.presenceTargets),
  };
}

export function registerReconnectHandlers(
  socket: Socket,
  accessService: ConversationAccessService,
  connectionStore: ConnectionStore,
  presenceSubscriptionStore: PresenceSubscriptionStore,
  roomSubscriptionStore: RoomSubscriptionStore,
) {
  socket.on("realtime:resubscribe", async (data: unknown) => {
    const requestId = readRequestId(data);

    try {
      const event = readClientEvent(data, readRealtimeResubscribePayload);
      const auth = socket.data.auth;

      const joinedConversationIds: string[] = [];
      const joinedRoomNames: string[] = [];

      console.log("[realtime:resubscribe] start", {
        socketId: socket.id,
        userId: auth.userId,
        deviceId: auth.deviceId,
        conversationIds: event.payload.conversationIds,
        presenceTargets: event.payload.presenceTargets,
      });

      for (const conversationId of event.payload.conversationIds) {
        const canJoin = await accessService.canJoinConversation(
          auth.userId,
          conversationId,
        );

        if (!canJoin) {
          console.warn("[realtime:resubscribe] permission denied", {
            socketId: socket.id,
            userId: auth.userId,
            conversationId,
          });

          emitError(
            socket,
            event.requestId,
            "PERMISSION_DENIED",
            "Cannot resubscribe to conversation.",
          );
          return;
        }

        const roomName = conversationRoomName(conversationId);

        await socket.join(roomName);

        roomSubscriptionStore.remember(
          auth.userId,
          auth.deviceId,
          conversationId,
        );

        joinedConversationIds.push(conversationId);
        joinedRoomNames.push(roomName);

        console.log("[realtime:resubscribe] joined room", {
          socketId: socket.id,
          userId: auth.userId,
          conversationId,
          roomName,
          socketRooms: Array.from(socket.rooms),
        });
      }

      if (event.payload.presenceTargets.length > 0) {
        presenceSubscriptionStore.subscribe(
          socket.id,
          event.payload.presenceTargets,
        );

        for (const targetUserId of event.payload.presenceTargets) {
          const presence = connectionStore.getPresence(targetUserId);

          console.log("[realtime:resubscribe] presence snapshot", {
            socketId: socket.id,
            subscriberUserId: auth.userId,
            targetUserId,
            presence,
          });

          socket.emit("presence:update", presence);
        }
      }

      emitAck(socket, event.requestId, {
        joinedConversationIds,
        joinedConversationCount: joinedConversationIds.length,
        joinedRoomNames,
        presenceTargets: event.payload.presenceTargets,
        presenceTargetCount: event.payload.presenceTargets.length,
        socketRooms: Array.from(socket.rooms),
      });
    } catch (error) {
      console.error("[realtime:resubscribe] failed", {
        socketId: socket.id,
        requestId,
        error,
      });

      emitError(
        socket,
        requestId,
        error instanceof Error && error.message === "VALIDATION_FAILED"
          ? "VALIDATION_FAILED"
          : "INTERNAL_ERROR",
        "Failed to resubscribe realtime state.",
        false,
      );
    }
  });
}