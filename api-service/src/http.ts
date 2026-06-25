import { randomUUID } from "node:crypto";
import type { Response } from "express";

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_REFRESH_REVOKED"
  | "AUTH_REFRESH_REPLAY_DETECTED"
  | "AUTH_SESSION_REVOKED"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "USER_NOT_FOUND"
  | "DEVICE_PREKEY_NOT_FOUND"
  | "CONVERSATION_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "INTERNAL_ERROR";

export function ok(res: Response, data: unknown, meta: Record<string, unknown> = {}) {
  return res.json({
    success: true,
    data,
    meta,
  });
}

export function fail(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  requestId = randomUUID(),
) {
  return res.status(status).json({
    success: false,
    error: {
      code,
      message,
      requestId,
    },
  });
}
