import type { Socket } from "socket.io";
import type { ConversationAccessService } from "../services/conversationAccess.js";
import { isObject, isUuid, readClientEvent, readRequestId } from "./events.js";
import { conversationRoomName } from "./rooms.js";
import { emitAck, emitError } from "./system.js";

type KeyExchangeInitPayload = {
  conversationId: string;
  curve: "x25519" | "p256";
  publicKey: string;
  sessionProposalId: string;
};

type KeyExchangeResponsePayload = {
  conversationId: string;
  sessionProposalId: string;
  publicKey: string;
  accepted: boolean;
};

type KeyRekeyRequiredPayload = {
  conversationId: string;
  expectedKeyVersion: number;
  receivedKeyVersion: number;
  reason: string;
};

type KeyRouteOptions<TPayload extends { conversationId: string }> = {
  socket: Socket;
  accessService: ConversationAccessService;
  data: unknown;
  eventName: "key:exchange:init" | "key:exchange:response" | "key:rekey_required";
  readPayload: (payload: Record<string, unknown>) => TPayload;
  buildOutgoingPayload?: (payload: TPayload, auth: { userId: string; deviceId: string }) => object;
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

function readKeyExchangeInitPayload(payload: Record<string, unknown>): KeyExchangeInitPayload {
  if (
    !isUuid(payload.conversationId) ||
    !isUuid(payload.sessionProposalId) ||
    !isBase64(payload.publicKey) ||
    (payload.curve !== "x25519" && payload.curve !== "p256")
  ) {
    throw new Error("VALIDATION_FAILED");
  }

  return {
    conversationId: payload.conversationId,
    curve: payload.curve,
    publicKey: payload.publicKey,
    sessionProposalId: payload.sessionProposalId,
  };
}

function readKeyExchangeResponsePayload(
  payload: Record<string, unknown>,
): KeyExchangeResponsePayload {
  if (
    !isUuid(payload.conversationId) ||
    !isUuid(payload.sessionProposalId) ||
    !isBase64(payload.publicKey) ||
    typeof payload.accepted !== "boolean"
  ) {
    throw new Error("VALIDATION_FAILED");
  }

  return {
    conversationId: payload.conversationId,
    sessionProposalId: payload.sessionProposalId,
    publicKey: payload.publicKey,
    accepted: payload.accepted,
  };
}

function readKeyRekeyRequiredPayload(payload: Record<string, unknown>): KeyRekeyRequiredPayload {
  if (
    !isUuid(payload.conversationId) ||
    !isPositiveInteger(payload.expectedKeyVersion) ||
    !isPositiveInteger(payload.receivedKeyVersion) ||
    typeof payload.reason !== "string" ||
    payload.reason.length === 0
  ) {
    throw new Error("VALIDATION_FAILED");
  }

  return {
    conversationId: payload.conversationId,
    expectedKeyVersion: payload.expectedKeyVersion,
    receivedKeyVersion: payload.receivedKeyVersion,
    reason: payload.reason,
  };
}

async function routeKeyEvent<TPayload extends { conversationId: string }>({
  socket,
  accessService,
  data,
  eventName,
  readPayload,
  buildOutgoingPayload,
}: KeyRouteOptions<TPayload>) {
  const requestId = readRequestId(data);

  try {
    const event = readClientEvent(data, readPayload);
    const auth = socket.data.auth;
    const canRoute = await accessService.canJoinConversation(auth.userId, event.payload.conversationId);

    if (!canRoute) {
      emitError(socket, event.requestId, "PERMISSION_DENIED", "You are not allowed to route key events here.");
      return;
    }

    socket.to(conversationRoomName(event.payload.conversationId)).emit(eventName, {
      ...event.payload,
      senderUserId: auth.userId,
      senderDeviceId: auth.deviceId,
      ...(buildOutgoingPayload ? buildOutgoingPayload(event.payload, auth) : {}),
    });

    emitAck(socket, event.requestId, {
      eventName,
      conversationId: event.payload.conversationId,
    });
  } catch (error) {
    emitError(
      socket,
      requestId,
      error instanceof Error && error.message === "VALIDATION_FAILED"
        ? "VALIDATION_FAILED"
        : "INTERNAL_ERROR",
      `Failed to route ${eventName}.`,
      false,
    );
  }
}

export function registerKeyHandlers(
  socket: Socket,
  accessService: ConversationAccessService,
) {
  socket.on("key:exchange:init", (data: unknown) =>
    routeKeyEvent({
      socket,
      accessService,
      data,
      eventName: "key:exchange:init",
      readPayload: readKeyExchangeInitPayload,
    }),
  );

  socket.on("key:exchange:response", (data: unknown) =>
    routeKeyEvent({
      socket,
      accessService,
      data,
      eventName: "key:exchange:response",
      readPayload: readKeyExchangeResponsePayload,
    }),
  );

  socket.on("key:rekey_required", (data: unknown) =>
    routeKeyEvent({
      socket,
      accessService,
      data,
      eventName: "key:rekey_required",
      readPayload: readKeyRekeyRequiredPayload,
    }),
  );
}
