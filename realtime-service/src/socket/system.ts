import type { Socket } from "socket.io";
import { createUuidV7 } from "../utils/ids.js";

export type SocketErrorCode =
  | "AUTH_INVALID"
  | "PERMISSION_DENIED"
  | "CONVERSATION_NOT_FOUND"
  | "RATE_LIMITED"
  | "MESSAGE_PERSIST_FAILED"
  | "KEY_VERSION_MISMATCH"
  | "REPLAY_DETECTED"
  | "CALL_STATE_CONFLICT"
  | "VALIDATION_FAILED"
  | "INTERNAL_ERROR";

export function emitAck(socket: Socket, requestId: string, meta?: Record<string, unknown>) {
  socket.emit("system:ack", {
    requestId,
    status: "ok",
    serverEventId: createUuidV7(),
    serverTimestamp: new Date().toISOString(),
    ...(meta ? { meta } : {}),
  });
}

export function emitError(
  socket: Socket,
  requestId: string | undefined,
  errorCode: SocketErrorCode,
  errorMessage: string,
  retryable = false,
  details?: Record<string, unknown>,
) {
  socket.emit("system:error", {
    requestId: requestId ?? createUuidV7(),
    status: "error",
    errorCode,
    errorMessage,
    retryable,
    ...(details ? { details } : {}),
  });
}
