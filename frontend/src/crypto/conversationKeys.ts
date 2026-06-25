import type { E2eeSetupAad, Message, UUID, WrappedKeyEntry } from "../types/index.js";
import { ApiError, apiClient } from "../api/client.js";
import { cryptoManager } from "./manager.js";
import { getDevicePrivateKey } from "./deviceKey.js";
import { getActiveCryptoUserId, requireActiveCryptoUserId, setActiveCryptoUserId } from "./cryptoSession.js";

export { setActiveCryptoUserId, getActiveCryptoUserId };

export class PeerPrekeyMissingError extends Error {
  constructor() {
    super("PEER_PREKEY_MISSING");
    this.name = "PeerPrekeyMissingError";
  }
}

const KEY_STORAGE_PREFIX = "e2ee:key:";

function scopedKeyStorageKey(conversationId: string, keyVersion: number, userId: UUID): string {
  return `${KEY_STORAGE_PREFIX}${userId}:${conversationId}:${keyVersion}`;
}

function legacyKeyStorageKey(conversationId: string, keyVersion: number): string {
  return `${KEY_STORAGE_PREFIX}${conversationId}:${keyVersion}`;
}

function readStoredConversationKey(conversationId: string, keyVersion: number): string | null {
  const userId = getActiveCryptoUserId();
  if (userId) {
    const scoped = localStorage.getItem(scopedKeyStorageKey(conversationId, keyVersion, userId));
    if (scoped) return scoped;
  }
  return localStorage.getItem(legacyKeyStorageKey(conversationId, keyVersion));
}

export function isE2eeSetupAad(aad: Record<string, unknown> | undefined): aad is E2eeSetupAad {
  return (
    aad !== undefined &&
    (aad.e2eeSetup === "g-lite-v1" || aad.e2eeSetup === "g-lite-v2") &&
    typeof aad.senderEphemeralPublicKey === "string" &&
    typeof aad.senderDeviceId === "string"
  );
}

export function findGliteSetupAad(messages: Message[]): E2eeSetupAad | undefined {
  // Earliest setup aad — canonical G-lite key for both peers.
  for (const message of messages) {
    const aad = message.envelope.aad;
    if (isE2eeSetupAad(aad)) return aad;
  }
  return undefined;
}

export function conversationHasGliteSetup(messages: Message[]): boolean {
  return findGliteSetupAad(messages) !== undefined;
}

export function clearConversationKey(conversationId: UUID, keyVersion = 1): void {
  cryptoManager.clearConversationKey(conversationId, keyVersion);
  const userId = getActiveCryptoUserId();
  if (userId) {
    localStorage.removeItem(scopedKeyStorageKey(conversationId, keyVersion, userId));
  }
  localStorage.removeItem(legacyKeyStorageKey(conversationId, keyVersion));
}

export async function saveConversationKey(
  conversationId: string,
  keyVersion: number,
  key: CryptoKey,
): Promise<void> {
  const userId = requireActiveCryptoUserId();
  try {
    const jwk = await cryptoManager.exportKeyToJwk(key);
    localStorage.setItem(scopedKeyStorageKey(conversationId, keyVersion, userId), jwk);
  } catch (err) {
    console.error("Failed to persist conversation key:", err);
  }
}

export async function loadConversationKey(
  conversationId: string,
  keyVersion: number,
): Promise<boolean> {
  if (cryptoManager.getConversationKey(conversationId, keyVersion)) {
    return true;
  }
  try {
    const stored = readStoredConversationKey(conversationId, keyVersion);
    if (!stored) return false;
    const key = await cryptoManager.importKeyFromJwk(stored);
    cryptoManager.setConversationKey(conversationId, keyVersion, key);
    return true;
  } catch (err) {
    console.error("Failed to load conversation key:", err);
    return false;
  }
}

export type DeriveOptions = { setPrimary?: boolean };

// Additive, non-destructive: derive the conversation key carried by a setup aad and
// register it as a candidate (and optionally the primary). Supports g-lite-v2 fan-out
// (unwrap K from the entry wrapped to this device) and legacy g-lite-v1 (direct ECDH).
export async function deriveKeyFromSetupAad(
  conversationId: UUID,
  aad: Record<string, unknown> | undefined,
  options: DeriveOptions = {},
): Promise<boolean> {
  if (!isE2eeSetupAad(aad)) return false;

  const devicePrivate = await getDevicePrivateKey();
  if (!devicePrivate) return false;

  let wrappingKey: CryptoKey;
  try {
    const ephemeralPublic = await cryptoManager.importEcdhPublicKey(aad.senderEphemeralPublicKey);
    wrappingKey = await cryptoManager.deriveSharedKey(devicePrivate, ephemeralPublic, conversationId);
  } catch (err) {
    console.error("G-lite shared-key derivation failed:", err);
    return false;
  }

  let conversationKey: CryptoKey | null = null;
  if (aad.wrappedKeys && aad.wrappedKeys.length > 0) {
    // v2: the ECDH result wraps a random K. Trial-unwrap each entry; only the one
    // wrapped to this device's prekey decrypts.
    for (const entry of aad.wrappedKeys) {
      try {
        conversationKey = await cryptoManager.unwrapKey(wrappingKey, entry.nonce, entry.ciphertext);
        break;
      } catch {
        // not wrapped for this device — try next entry
      }
    }
    if (!conversationKey) return false;
  } else {
    // v1 legacy: the ECDH-derived key IS the conversation key.
    conversationKey = wrappingKey;
  }

  await cryptoManager.addCandidateKey(conversationId, conversationKey);
  if (options.setPrimary || !cryptoManager.hasConversationKey(conversationId)) {
    cryptoManager.setConversationKey(conversationId, 1, conversationKey);
    await saveConversationKey(conversationId, 1, conversationKey);
  }
  return true;
}

async function trialDecryptMessage(message: Message): Promise<boolean> {
  const { conversationId, envelope } = message;
  const result = await cryptoManager.tryDecryptWithCandidates(
    conversationId,
    envelope.ciphertext,
    envelope.nonce,
  );
  return result !== null;
}

// Rebuild the candidate key set for a conversation from local storage + every setup
// aad in history. Non-destructive: never clears a working key. The primary (used to
// encrypt new messages) converges on the canonical key = the earliest setup aad, which
// both peers can reproduce, so future sends stop diverging.
export async function ensureKeyFromGliteHistory(
  conversationId: UUID,
  messages: Message[],
): Promise<boolean> {
  const earliestAad = findGliteSetupAad(messages);
  if (!earliestAad) return false;
  const earliestMessage = messages.find((m) => isE2eeSetupAad(m.envelope.aad));

  // 1. Own stored key (the sender minted + persisted it). Never wiped.
  await loadConversationKey(conversationId, 1);

  // 2. Ensure primary == canonical key (earliest setup). Keep the stored key if it
  //    already decrypts the earliest setup message; otherwise derive from that aad.
  const primaryDecryptsEarliest =
    cryptoManager.hasConversationKey(conversationId) &&
    earliestMessage !== undefined &&
    (await trialDecryptMessage(earliestMessage));
  if (!primaryDecryptsEarliest) {
    await deriveKeyFromSetupAad(conversationId, earliestAad, { setPrimary: true });
  }

  // 3. Register every other setup aad's key as a candidate (covers glare where each
  //    peer minted a different key, and multi-device fan-out copies).
  for (const m of messages) {
    const aad = m.envelope.aad;
    if (isE2eeSetupAad(aad) && aad !== earliestAad) {
      await deriveKeyFromSetupAad(conversationId, aad, { setPrimary: false });
    }
  }

  return (
    cryptoManager.hasConversationKey(conversationId) ||
    cryptoManager.getCandidateKeys(conversationId).length > 0
  );
}

export type EnsureKeyResult = {
  setupAad?: E2eeSetupAad;
};

export async function ensureKeyForSend(
  conversationId: UUID,
  peerUserId: UUID,
  senderDeviceId: UUID,
): Promise<EnsureKeyResult> {
  await loadConversationKey(conversationId, 1);
  if (cryptoManager.hasConversationKey(conversationId)) {
    return {};
  }

  const selfUserId = requireActiveCryptoUserId();

  // Fan-out: fetch every device prekey of the peer AND of self, so any context of
  // either participant can later unwrap the conversation key.
  let peerKeys: { deviceId: UUID; publicKey: string }[];
  let selfKeys: { deviceId: UUID; publicKey: string }[];
  try {
    [peerKeys, selfKeys] = await Promise.all([
      apiClient.getUserEcdhPublicKeys(peerUserId),
      apiClient.getUserEcdhPublicKeys(selfUserId),
    ]);
  } catch (err) {
    if (
      err instanceof ApiError &&
      err.statusCode === 404 &&
      (err.errorCode === "DEVICE_PREKEY_NOT_FOUND" || err.errorCode === "USER_NOT_FOUND")
    ) {
      throw new PeerPrekeyMissingError();
    }
    throw err;
  }

  if (peerKeys.length === 0) {
    // Peer has never registered a prekey — fall back to socket key exchange.
    throw new PeerPrekeyMissingError();
  }

  // Dedupe by public key (a context that logged in repeatedly registers duplicates).
  const byPublicKey = new Map<string, { deviceId: UUID; publicKey: string }>();
  for (const k of [...peerKeys, ...selfKeys]) {
    if (!byPublicKey.has(k.publicKey)) byPublicKey.set(k.publicKey, k);
  }

  const conversationKey = await cryptoManager.generateConversationKey();
  const rawKey = await cryptoManager.exportRawKey(conversationKey);
  const ephemeral = await cryptoManager.generateEcdhKeyPair();

  const wrappedKeys: WrappedKeyEntry[] = [];
  for (const prekey of byPublicKey.values()) {
    try {
      const prekeyPublic = await cryptoManager.importEcdhPublicKey(prekey.publicKey);
      const wrappingKey = await cryptoManager.deriveSharedKey(
        ephemeral.privateKey,
        prekeyPublic,
        conversationId,
      );
      const { nonce, ciphertext } = await cryptoManager.wrapKey(wrappingKey, rawKey);
      wrappedKeys.push({ deviceId: prekey.deviceId, nonce, ciphertext });
    } catch (err) {
      console.error("Failed to wrap conversation key for a device prekey:", err);
    }
  }

  if (wrappedKeys.length === 0) {
    throw new PeerPrekeyMissingError();
  }

  cryptoManager.setConversationKey(conversationId, 1, conversationKey);
  await saveConversationKey(conversationId, 1, conversationKey);

  const senderEphemeralPublicKey = await cryptoManager.exportEcdhPublicKey(ephemeral.publicKey);
  return {
    setupAad: {
      e2eeSetup: "g-lite-v2",
      senderEphemeralPublicKey,
      senderDeviceId,
      wrappedKeys,
    },
  };
}

export async function decryptMessage(message: Message): Promise<Message> {
  const { conversationId, envelope } = message;

  // If this message carries a setup aad, register its key as a candidate first.
  if (isE2eeSetupAad(envelope.aad)) {
    await deriveKeyFromSetupAad(conversationId, envelope.aad, { setPrimary: false });
  } else if (cryptoManager.getCandidateKeys(conversationId).length === 0) {
    await loadConversationKey(conversationId, envelope.keyVersion);
  }

  const plaintext = await cryptoManager.tryDecryptWithCandidates(
    conversationId,
    envelope.ciphertext,
    envelope.nonce,
  );
  if (plaintext !== null) {
    return { ...message, plaintext };
  }
  return message;
}

export function hasConversationKey(conversationId: UUID): boolean {
  return cryptoManager.hasConversationKey(conversationId);
}
