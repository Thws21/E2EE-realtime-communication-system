import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

export type JwtPayload = Record<string, unknown> & {
  sub: string;
  exp: number;
  iat: number;
};

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function signHmac(input: string, secret: string) {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

function safeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashSecret(secret: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(secret, salt, 64).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

export function verifySecret(secret: string, storedHash: string) {
  const [scheme, salt, hash] = storedHash.split(":");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }

  const computed = scryptSync(secret, salt, 64).toString("base64url");
  return safeEqualText(computed, hash);
}

export function sha256(input: string) {
  return createHash("sha256").update(input).digest("base64url");
}

export function randomOtpCode() {
  return String(randomInt(100000, 1000000));
}

export function randomToken() {
  return randomBytes(48).toString("base64url");
}

export function signJwt(
  subject: string,
  secret: string,
  ttlSec: number,
  extra: Record<string, unknown> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: JwtPayload = {
    ...extra,
    sub: subject,
    iat: now,
    exp: now + ttlSec,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = signHmac(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  try {
    const [encodedHeader, encodedPayload, signature] = token.split(".");
    if (!encodedHeader || !encodedPayload || !signature) {
      return null;
    }

    const expectedSignature = signHmac(`${encodedHeader}.${encodedPayload}`, secret);
    if (!safeEqualText(signature, expectedSignature)) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as JwtPayload;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
