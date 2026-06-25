import { createHmac, timingSafeEqual } from "node:crypto";
import type { ExtendedError, Socket } from "socket.io";
import type { AppConfig } from "../config.js";

export type AuthContext = {
  userId: string;
  deviceId: string;
  sessionId: string;
};

type JwtClaims = {
  sub?: unknown;
  sid?: unknown;
  deviceId?: unknown;
  exp?: unknown;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createAuthError(message = "AUTH_INVALID"): ExtendedError {
  const error = new Error(message) as ExtendedError;
  error.data = {
    errorCode: "AUTH_INVALID",
  };
  return error;
}

function readAccessToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.accessToken;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim();
  }

  const authorization = socket.handshake.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return null;
}

function decodeBase64Url(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function verifyHs256Jwt(token: string, secret: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw createAuthError();
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw createAuthError();
  }

  const header = JSON.parse(decodeBase64Url(encodedHeader).toString("utf8")) as { alg?: unknown };
  if (header.alg !== "HS256") {
    throw createAuthError();
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const actualSignature = decodeBase64Url(encodedSignature);

  if (
    expectedSignature.length !== actualSignature.length ||
    !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    throw createAuthError();
  }

  return JSON.parse(decodeBase64Url(encodedPayload).toString("utf8")) as JwtClaims;
}

function authContextFromClaims(claims: JwtClaims): AuthContext {
  const userId = typeof claims.sub === "string" ? claims.sub : "";
  const sessionId = typeof claims.sid === "string" ? claims.sid : "";
  const deviceId = typeof claims.deviceId === "string" ? claims.deviceId : "";
  const expiresAt = typeof claims.exp === "number" ? claims.exp : 0;

  if (!uuidRegex.test(userId) || !uuidRegex.test(sessionId) || !uuidRegex.test(deviceId)) {
    throw createAuthError();
  }

  if (expiresAt <= Math.floor(Date.now() / 1000)) {
    throw createAuthError("AUTH_TOKEN_EXPIRED");
  }

  return {
    userId,
    deviceId,
    sessionId,
  };
}

function authContextFromDevToken(token: string): AuthContext {
  const [prefix, userId, deviceId, sessionId] = token.split(":");
  if (prefix !== "dev" || !userId || !deviceId || !sessionId) {
    throw createAuthError();
  }

  if (!uuidRegex.test(userId) || !uuidRegex.test(deviceId) || !uuidRegex.test(sessionId)) {
    throw createAuthError();
  }

  return {
    userId,
    deviceId,
    sessionId,
  };
}

function requireJwtSecret(secret: string): string {
  if (!secret) {
    throw createAuthError();
  }

  return secret;
}

export function createSocketAuthMiddleware(config: AppConfig) {
  return (socket: Socket, next: (err?: ExtendedError) => void) => {
    try {
      const token = readAccessToken(socket);
      if (!token) {
        throw createAuthError();
      }

      const authContext =
        config.allowDevSocketAuth && token.startsWith("dev:")
          ? authContextFromDevToken(token)
          : authContextFromClaims(verifyHs256Jwt(token, requireJwtSecret(config.jwtAccessSecret)));

      socket.data.auth = authContext;
      next();
    } catch (error) {
      next(error instanceof Error ? (error as ExtendedError) : createAuthError());
    }
  };
}
