import type { Socket } from "socket.io";
import type { ConversationAccessService } from "../services/conversationAccess.js";
import type { MessagePersistenceService } from "../services/messagePersistence.js";
import type { DedupeResult, DedupeStore } from "../stores/dedupeStore.js";
import type { NonceReplayStore } from "../stores/nonceReplayStore.js";
import { isObject, isUuid, readClientEvent, readRequestId } from "./events.js";
import { conversationRoomName } from "./rooms.js";
import { emitAck, emitError } from "./system.js";

type ChatSendPayload = {
  conversationId: string;
  messageId: string;
  ciphertext: string;
  nonce: string;
  algorithm: "aes-256-gcm";
  keyVersion: number;
  aad?: Record<string, unknown>;
  clientMessageSeq: number;
};

function isBase64(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }

  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function readChatSendPayload(payload: Record<string, unknown>): ChatSendPayload {
  if (!isUuid(payload.conversationId) || !isUuid(payload.messageId)) {
    throw new Error("VALIDATION_FAILED");
  }

  if (!isBase64(payload.ciphertext) || !isBase64(payload.nonce)) {
    throw new Error("VALIDATION_FAILED");
  }

  if (payload.algorithm !== "aes-256-gcm") {
    throw new Error("VALIDATION_FAILED");
  }

  if (!isPositiveInteger(payload.keyVersion) || !isNonNegativeInteger(payload.clientMessageSeq)) {
    throw new Error("VALIDATION_FAILED");
  }

  if (payload.aad !== undefined && !isObject(payload.aad)) {
    throw new Error("VALIDATION_FAILED");
  }

  return {
    conversationId: payload.conversationId,
    messageId: payload.messageId,
    ciphertext: payload.ciphertext,
    nonce: payload.nonce,
    algorithm: payload.algorithm,
    keyVersion: payload.keyVersion,
    ...(payload.aad ? { aad: payload.aad } : {}),
    clientMessageSeq: payload.clientMessageSeq,
  };
}

type DeliveredPayload = {
  conversationId: string;
  messageId: string;
};

type ReadPayload = {
  conversationId: string;
  messageIds: string[];
};

function readDeliveredPayload(payload: Record<string, unknown>): DeliveredPayload {
  if (!isUuid(payload.conversationId) || !isUuid(payload.messageId)) {
    throw new Error("VALIDATION_FAILED");
  }
  return {
    conversationId: payload.conversationId,
    messageId: payload.messageId,
  };
}

function readReadPayload(payload: Record<string, unknown>): ReadPayload {
  if (
    !isUuid(payload.conversationId) ||
    !Array.isArray(payload.messageIds) ||
    payload.messageIds.length === 0 ||
    !payload.messageIds.every(isUuid)
  ) {
    throw new Error("VALIDATION_FAILED");
  }
  return {
    conversationId: payload.conversationId,
    messageIds: payload.messageIds as string[],
  };
}

function replayDedupeResult(socket: Socket, requestId: string, result: DedupeResult) {
  // Idempotent retry: replay cached result for the same requestId.
  if (result.type === "success") {
    emitAck(socket, requestId, {
      ...result.meta,
      dedupedByRealtime: true,
    });
    return;
  }

  emitError(
    socket,
    requestId,
    result.errorCode,
    result.errorMessage,
    result.retryable,
    result.details,
  );
}

export function registerChatHandlers(
  socket: Socket,
  accessService: ConversationAccessService,
  persistenceService: MessagePersistenceService,
  dedupeStore: DedupeStore,
  nonceReplayStore: NonceReplayStore,
) {
  socket.on("chat:send", async (data: unknown) => {
    const requestId = readRequestId(data);

    try {
      const event = readClientEvent(data, readChatSendPayload);
      const auth = socket.data.auth;

      const canSend = await accessService.canJoinConversation(
        auth.userId,
        event.payload.conversationId,
      );

      if (!canSend) {
        emitError(
          socket,
          event.requestId,
          "PERMISSION_DENIED",
          "You are not allowed to send messages in this conversation.",
        );
        return;
      }

      const dedupeKey = dedupeStore.createKey({
        requestId: event.requestId,
        senderDeviceId: auth.deviceId,
        conversationId: event.payload.conversationId,
      });
      const existingResult = dedupeStore.get(dedupeKey);

      if (existingResult) {
        replayDedupeResult(socket, event.requestId, existingResult);
        return;
      }

      const nonceReplayKey = nonceReplayStore.createKey({
        senderDeviceId: auth.deviceId,
        conversationId: event.payload.conversationId,
        nonce: event.payload.nonce,
        keyVersion: event.payload.keyVersion,
      });

      if (nonceReplayStore.has(nonceReplayKey)) {
        const errorResult = {
          type: "error" as const,
          errorCode: "REPLAY_DETECTED" as const,
          errorMessage: "Message nonce was already used for this device and key version.",
          retryable: false,
          details: {
            conversationId: event.payload.conversationId,
            messageId: event.payload.messageId,
            keyVersion: event.payload.keyVersion,
          },
        };

        emitError(
          socket,
          event.requestId,
          errorResult.errorCode,
          errorResult.errorMessage,
          errorResult.retryable,
          errorResult.details,
        );
        dedupeStore.set(dedupeKey, errorResult);
        return;
      }

      try {
        const persistResult = await persistenceService.persistMessage({
          requestId: event.requestId,
          messageId: event.payload.messageId,
          conversationId: event.payload.conversationId,
          senderUserId: auth.userId,
          senderDeviceId: auth.deviceId,
          envelope: {
            ciphertext: event.payload.ciphertext,
            nonce: event.payload.nonce,
            algorithm: event.payload.algorithm,
            keyVersion: event.payload.keyVersion,
            ...(event.payload.aad ? { aad: event.payload.aad } : {}),
            clientMessageSeq: event.payload.clientMessageSeq,
          },
        });

        const successMeta = {
          messageId: event.payload.messageId,
          conversationId: event.payload.conversationId,
          stored: persistResult.stored,
          deduped: persistResult.deduped,
          createdAt: persistResult.createdAt,
        };

        emitAck(socket, event.requestId, successMeta);

        // RT-12: Fanout ciphertext cho cac socket khac trong conversation room.
        const roomName = conversationRoomName(event.payload.conversationId);
        const socketsInRoom = await socket.nsp.in(roomName).allSockets();

        console.log("[chat:send] fanout", {
          senderSocketId: socket.id,
          senderUserId: auth.userId,
          conversationId: event.payload.conversationId,
          roomName,
          socketsInRoom: Array.from(socketsInRoom),
        });

        socket.to(roomName).emit("chat:message", {
          messageId: event.payload.messageId,
          conversationId: event.payload.conversationId,
          senderUserId: auth.userId,
          senderDeviceId: auth.deviceId,
          ciphertext: event.payload.ciphertext,
          nonce: event.payload.nonce,
          algorithm: event.payload.algorithm,
          keyVersion: event.payload.keyVersion,
          ...(event.payload.aad ? { aad: event.payload.aad } : {}),
          createdAt: persistResult.createdAt,
        });

        nonceReplayStore.markUsed(nonceReplayKey);

        dedupeStore.set(dedupeKey, {
          type: "success",
          meta: successMeta,
        });
      } catch (persistError) {
        const errorResult = {
          type: "error" as const,
          errorCode: "MESSAGE_PERSIST_FAILED" as const,
          errorMessage: "Message persistence failed.",
          retryable: true,
          details: {
            reason: persistError instanceof Error ? persistError.message : "UNKNOWN",
            conversationId: event.payload.conversationId,
            messageId: event.payload.messageId,
          },
        };

        emitError(
          socket,
          event.requestId,
          errorResult.errorCode,
          errorResult.errorMessage,
          errorResult.retryable,
          errorResult.details,
        );
        dedupeStore.set(dedupeKey, errorResult);
      }
    } catch (error) {
      const errorCode =
        error instanceof Error && error.message === "VALIDATION_FAILED"
          ? "VALIDATION_FAILED"
          : "INTERNAL_ERROR";

      emitError(
        socket,
        requestId,
        errorCode,
        "Invalid chat:send payload.",
        false,
      );
    }
  });

  // Fanout receipts only; persistence is handled by the API via REST.
  socket.on("chat:delivered", async (data: unknown) => {
    const requestId = readRequestId(data);
    try {
      const event = readClientEvent(data, readDeliveredPayload);
      const auth = socket.data.auth;
      const canRoute = await accessService.canJoinConversation(
        auth.userId,
        event.payload.conversationId,
      );
      if (!canRoute) {
        emitError(socket, event.requestId, "PERMISSION_DENIED", "Not a conversation member.");
        return;
      }

      socket.to(conversationRoomName(event.payload.conversationId)).emit("message:receipt", {
        conversationId: event.payload.conversationId,
        messageIds: [event.payload.messageId],
        userId: auth.userId,
        status: "delivered",
      });

      emitAck(socket, event.requestId, {
        conversationId: event.payload.conversationId,
        status: "delivered",
      });
    } catch (error) {
      emitError(
        socket,
        requestId,
        error instanceof Error && error.message === "VALIDATION_FAILED"
          ? "VALIDATION_FAILED"
          : "INTERNAL_ERROR",
        "Invalid chat:delivered payload.",
        false,
      );
    }
  });

  socket.on("chat:read", async (data: unknown) => {
    const requestId = readRequestId(data);
    try {
      const event = readClientEvent(data, readReadPayload);
      const auth = socket.data.auth;
      const canRoute = await accessService.canJoinConversation(
        auth.userId,
        event.payload.conversationId,
      );
      if (!canRoute) {
        emitError(socket, event.requestId, "PERMISSION_DENIED", "Not a conversation member.");
        return;
      }

      socket.to(conversationRoomName(event.payload.conversationId)).emit("message:receipt", {
        conversationId: event.payload.conversationId,
        messageIds: event.payload.messageIds,
        userId: auth.userId,
        status: "read",
      });

      emitAck(socket, event.requestId, {
        conversationId: event.payload.conversationId,
        status: "read",
      });
    } catch (error) {
      emitError(
        socket,
        requestId,
        error instanceof Error && error.message === "VALIDATION_FAILED"
          ? "VALIDATION_FAILED"
          : "INTERNAL_ERROR",
        "Invalid chat:read payload.",
        false,
      );
    }
  });
}
