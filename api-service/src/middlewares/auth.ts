import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { pool } from "../db.js";
import { fail } from "../http.js";
import { verifyJwt } from "../security.js";
import { isUuid } from "../validation.js";

export async function authRequired(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();
  const authorization = req.header("Authorization") ?? "";

  if (!authorization.startsWith("Bearer ")) {
    return fail(res, 401, "AUTH_INVALID_CREDENTIALS", "Bearer access token is required", requestId);
  }

  const token = authorization.slice("Bearer ".length).trim();
  const payload = token ? verifyJwt(token, config.jwtAccessSecret) : null;
  const sessionId = payload?.sid;
  const deviceId = payload?.deviceId;

  if (
    !payload ||
    typeof sessionId !== "string" ||
    typeof deviceId !== "string" ||
    !isUuid(payload.sub) ||
    !isUuid(sessionId) ||
    !isUuid(deviceId)
  ) {
    return fail(res, 401, "AUTH_TOKEN_EXPIRED", "Access token is invalid or expired", requestId);
  }

  try {
    const result = await pool.query<{
      user_id: string;
      session_id: string;
      revoked_at: Date | null;
    }>(
      `
        SELECT
          user_id,
          id AS session_id,
          revoked_at
        FROM sessions
        WHERE id = $1 AND user_id = $2
        LIMIT 1
      `,
      [sessionId, payload.sub],
    );

    const session = result.rows[0];
    if (!session || session.revoked_at) {
      return fail(res, 401, "AUTH_SESSION_REVOKED", "Session is revoked", requestId);
    }

    req.auth = {
      userId: session.user_id,
      sessionId: session.session_id,
      deviceId,
    };

    return next();
  } catch {
    return fail(res, 500, "INTERNAL_ERROR", "Could not validate access token", requestId);
  }
}
