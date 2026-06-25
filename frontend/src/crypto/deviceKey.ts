import type { UUID } from "../types/index.js";
import { cryptoManager } from "./manager.js";
import { getActiveCryptoUserId, requireActiveCryptoUserId } from "./cryptoSession.js";

const LEGACY_DEVICE_ECDH_PRIVATE_JWK = "e2ee:device:ecdh:private";

function getDeviceKeyStorageKey(userId: UUID): string {
  return `e2ee:device:ecdh:private:${userId}`;
}

function migrateLegacyDeviceKey(userId: UUID): void {
  const scopedKey = getDeviceKeyStorageKey(userId);
  if (localStorage.getItem(scopedKey)) return;

  const legacy = localStorage.getItem(LEGACY_DEVICE_ECDH_PRIVATE_JWK);
  if (!legacy) return;

  localStorage.setItem(scopedKey, legacy);
}

async function importEcdhPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
}

async function publicKeyFromPrivateJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  const publicJwk = { ...jwk };
  delete publicJwk.d;
  delete publicJwk.key_ops;
  delete publicJwk.ext;
  return crypto.subtle.importKey(
    "jwk",
    publicJwk as JsonWebKey,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
}

export async function ensureDeviceEcdhKeyPair(userId?: UUID): Promise<CryptoKeyPair> {
  const resolvedUserId = userId ?? requireActiveCryptoUserId();
  migrateLegacyDeviceKey(resolvedUserId);

  const storageKey = getDeviceKeyStorageKey(resolvedUserId);
  const stored = localStorage.getItem(storageKey);
  if (stored) {
    try {
      const jwk = JSON.parse(stored) as JsonWebKey;
      const privateKey = await importEcdhPrivateKey(jwk);
      const publicKey = await publicKeyFromPrivateJwk(jwk);
      return { privateKey, publicKey };
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  const keyPair = await cryptoManager.generateEcdhKeyPair();
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  localStorage.setItem(storageKey, JSON.stringify(privateJwk));
  return keyPair;
}

export async function getDevicePrivateKey(userId?: UUID): Promise<CryptoKey | null> {
  const resolvedUserId = userId ?? getActiveCryptoUserId();
  if (!resolvedUserId) return null;

  migrateLegacyDeviceKey(resolvedUserId);
  const stored = localStorage.getItem(getDeviceKeyStorageKey(resolvedUserId));
  if (!stored) return null;
  try {
    const jwk = JSON.parse(stored) as JsonWebKey;
    return importEcdhPrivateKey(jwk);
  } catch {
    return null;
  }
}

export async function uploadDevicePublicKey(
  putPublicKey: (publicKey: string) => Promise<unknown>,
  userId?: UUID,
): Promise<void> {
  const resolvedUserId = userId ?? requireActiveCryptoUserId();
  const keyPair = await ensureDeviceEcdhKeyPair(resolvedUserId);
  const publicKey = await cryptoManager.exportEcdhPublicKey(keyPair.publicKey);
  await putPublicKey(publicKey);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadDevicePublicKeyWithRetry(
  putPublicKey: (publicKey: string) => Promise<unknown>,
  userId?: UUID,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await uploadDevicePublicKey(putPublicKey, userId);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}
