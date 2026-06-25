import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccessTokenClaims,
  normalizeDeviceInfo,
  readDeviceIdFromSessionInfo,
  resolveDeviceId,
} from "./accessToken.js";
import { isUuid } from "./validation.js";

test("buildAccessTokenClaims uses sid and deviceId", () => {
  const sessionId = "018f1234-5678-7890-abcd-ef1234567890";
  const deviceId = "018f1234-5678-7890-abcd-ef1234567891";

  const claims = buildAccessTokenClaims(sessionId, deviceId);

  assert.equal(claims.sid, sessionId);
  assert.equal(claims.deviceId, deviceId);
  assert.equal("sessionId" in claims, false);
});

test("resolveDeviceId accepts client deviceId when valid uuid", () => {
  const deviceId = "018f1234-5678-7890-abcd-ef1234567890";
  assert.equal(resolveDeviceId({ deviceId, platform: "web" }), deviceId);
});

test("resolveDeviceId generates uuid v7 when missing or invalid", () => {
  assert.ok(isUuid(resolveDeviceId({})));
  assert.ok(isUuid(resolveDeviceId({ deviceId: "not-a-uuid" })));
});

test("normalizeDeviceInfo always stores deviceId", () => {
  const normalized = normalizeDeviceInfo({ platform: "web" });
  assert.ok(isUuid(normalized.deviceId));
});

test("readDeviceIdFromSessionInfo reads stored deviceId", () => {
  const deviceId = "018f1234-5678-7890-abcd-ef1234567890";
  assert.equal(readDeviceIdFromSessionInfo({ deviceId }), deviceId);
  assert.equal(readDeviceIdFromSessionInfo({}), null);
});
