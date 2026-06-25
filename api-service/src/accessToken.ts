import { config } from "./config.js";
import { createUuidV7 } from "./ids.js";
import { signJwt } from "./security.js";
import { isUuid } from "./validation.js";

export type AccessTokenClaims = {
  sid: string;
  deviceId: string;
};

export function resolveDeviceId(deviceInfo: Record<string, unknown>): string {
  const candidate = deviceInfo.deviceId;
  if (isUuid(candidate)) {
    return candidate;
  }

  return createUuidV7();
}

export function normalizeDeviceInfo(deviceInfo: Record<string, unknown>): Record<string, unknown> {
  const deviceId = resolveDeviceId(deviceInfo);
  return {
    ...deviceInfo,
    deviceId,
  };
}

export function buildAccessTokenClaims(sessionId: string, deviceId: string): AccessTokenClaims {
  return {
    sid: sessionId,
    deviceId,
  };
}

export function issueAccessToken(userId: string, sessionId: string, deviceId: string): string {
  return signJwt(
    userId,
    config.jwtAccessSecret,
    config.accessTokenTtlSec,
    buildAccessTokenClaims(sessionId, deviceId),
  );
}

export function readDeviceIdFromSessionInfo(deviceInfo: unknown): string | null {
  if (!deviceInfo || typeof deviceInfo !== "object") {
    return null;
  }

  const deviceId = (deviceInfo as Record<string, unknown>).deviceId;
  return isUuid(deviceId) ? deviceId : null;
}
