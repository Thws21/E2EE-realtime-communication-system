export class CryptoManager {
  private conversationKeys: Map<string, Map<number, CryptoKey>> = new Map();
  // Extra keys (beyond the primary keyVersion slot) usable for trial-decryption.
  // Needed for glare (both peers minted a key) and multi-device fan-out, where a
  // conversation can legitimately have more than one key that decrypts its history.
  // Keyed by raw-key fingerprint (base64) to dedupe across repeated loads.
  private candidateKeys: Map<string, Map<string, CryptoKey>> = new Map();

  async encrypt(
    conversationId: string,
    plaintext: string,
    keyVersion: number,
    aad?: Record<string, unknown>,
  ): Promise<{
    ciphertext: string;
    nonce: string;
    algorithm: "aes-256-gcm";
    keyVersion: number;
  }> {
    const key = this.getConversationKey(conversationId, keyVersion);
    if (!key) {
      throw new Error(`No key for conversation ${conversationId} version ${keyVersion}`);
    }

    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(plaintext);
    const algorithm: AesGcmParams = {
      name: "AES-GCM",
      iv: nonce,
      ...(aad && { additionalData: new TextEncoder().encode(JSON.stringify(aad)) }),
    };

    const ciphertext = await crypto.subtle.encrypt(algorithm, key, data);

    return {
      ciphertext: this.bufferToBase64(ciphertext),
      nonce: this.bufferToBase64(nonce),
      algorithm: "aes-256-gcm",
      keyVersion,
    };
  }

  async decrypt(
    conversationId: string,
    ciphertext: string,
    nonce: string,
    keyVersion: number,
    aad?: Record<string, unknown>,
  ): Promise<string> {
    const key = this.getConversationKey(conversationId, keyVersion);
    if (!key) {
      throw new Error(`No key for conversation ${conversationId} version ${keyVersion}`);
    }

    const algorithm: AesGcmParams = {
      name: "AES-GCM",
      iv: this.base64ToBuffer(nonce) as BufferSource,
      ...(aad && { additionalData: new TextEncoder().encode(JSON.stringify(aad)) }),
    };

    const plaintext = await crypto.subtle.decrypt(
      algorithm,
      key,
      this.base64ToBuffer(ciphertext) as BufferSource,
    );

    return new TextDecoder().decode(plaintext);
  }

  setConversationKey(conversationId: string, keyVersion: number, key: CryptoKey): void {
    let versions = this.conversationKeys.get(conversationId);
    if (!versions) {
      versions = new Map();
      this.conversationKeys.set(conversationId, versions);
    }
    versions.set(keyVersion, key);
  }

  getConversationKey(conversationId: string, keyVersion: number): CryptoKey | undefined {
    return this.conversationKeys.get(conversationId)?.get(keyVersion);
  }

  hasConversationKey(conversationId: string): boolean {
    const versions = this.conversationKeys.get(conversationId);
    return versions !== undefined && versions.size > 0;
  }

  clearConversationKey(conversationId: string, keyVersion: number): void {
    const versions = this.conversationKeys.get(conversationId);
    if (versions) {
      versions.delete(keyVersion);
      if (versions.size === 0) {
        this.conversationKeys.delete(conversationId);
      }
    }
    this.candidateKeys.delete(conversationId);
  }

  clearAllConversationKeys(): void {
    this.conversationKeys.clear();
    this.candidateKeys.clear();
  }

  // --- Candidate keys & trial decryption (glare + multi-device) ---

  async addCandidateKey(conversationId: string, key: CryptoKey): Promise<void> {
    let fingerprint: string;
    try {
      fingerprint = await this.exportRawKey(key);
    } catch {
      // Non-extractable key (shouldn't happen here) — skip dedupe storage.
      return;
    }
    let bucket = this.candidateKeys.get(conversationId);
    if (!bucket) {
      bucket = new Map();
      this.candidateKeys.set(conversationId, bucket);
    }
    bucket.set(fingerprint, key);
  }

  getCandidateKeys(conversationId: string): CryptoKey[] {
    const primary = this.conversationKeys.get(conversationId);
    const primaryKeys = primary ? Array.from(primary.values()) : [];
    const extras = this.candidateKeys.get(conversationId);
    return extras ? [...primaryKeys, ...extras.values()] : primaryKeys;
  }

  // Try every known key (primary + candidates) until one decrypts. No GCM aad
  // is bound at encrypt time, so trial decryption omits additionalData.
  async tryDecryptWithCandidates(
    conversationId: string,
    ciphertext: string,
    nonce: string,
  ): Promise<string | null> {
    const iv = this.base64ToBuffer(nonce) as BufferSource;
    const data = this.base64ToBuffer(ciphertext) as BufferSource;
    for (const key of this.getCandidateKeys(conversationId)) {
      try {
        const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
        return new TextDecoder().decode(plaintext);
      } catch {
        // wrong key — try next
      }
    }
    return null;
  }

  // --- Random conversation key + key wrapping (multi-device fan-out) ---

  async generateConversationKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ]);
  }

  async exportRawKey(key: CryptoKey): Promise<string> {
    const raw = await crypto.subtle.exportKey("raw", key);
    return this.bufferToBase64(raw);
  }

  async importRawKey(rawBase64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      this.base64ToBuffer(rawBase64) as BufferSource,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"],
    );
  }

  // Wrap raw key bytes (base64) under an AES-GCM wrapping key derived via ECDH.
  async wrapKey(
    wrappingKey: CryptoKey,
    rawKeyBase64: string,
  ): Promise<{ nonce: string; ciphertext: string }> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      wrappingKey,
      this.base64ToBuffer(rawKeyBase64) as BufferSource,
    );
    return {
      nonce: this.bufferToBase64(nonce),
      ciphertext: this.bufferToBase64(ciphertext),
    };
  }

  // Unwrap a wrapped conversation key. Throws if the wrapping key does not match.
  async unwrapKey(
    wrappingKey: CryptoKey,
    nonce: string,
    ciphertext: string,
  ): Promise<CryptoKey> {
    const rawBytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: this.base64ToBuffer(nonce) as BufferSource },
      wrappingKey,
      this.base64ToBuffer(ciphertext) as BufferSource,
    );
    return crypto.subtle.importKey("raw", rawBytes, { name: "AES-GCM" }, true, [
      "encrypt",
      "decrypt",
    ]);
  }

  async generateEcdhKeyPair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    );
  }

  async exportEcdhPublicKey(publicKey: CryptoKey): Promise<string> {
    const spki = await crypto.subtle.exportKey("spki", publicKey);
    return this.bufferToBase64(spki);
  }

  async importEcdhPublicKey(base64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "spki",
      this.base64ToBuffer(base64) as BufferSource,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
  }

  async deriveSharedKey(
    myPrivateKey: CryptoKey,
    peerPublicKey: CryptoKey,
    conversationId: string,
  ): Promise<CryptoKey> {
    const sharedBits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: peerPublicKey },
      myPrivateKey,
      256,
    );

    const hkdfKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);

    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode(conversationId),
        info: new TextEncoder().encode("e2ee-chat-v1"),
      },
      hkdfKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
  }

  async exportKeyToJwk(key: CryptoKey): Promise<string> {
    const jwk = await crypto.subtle.exportKey("jwk", key);
    return btoa(JSON.stringify(jwk));
  }

  async importKeyFromJwk(jwkStr: string): Promise<CryptoKey> {
    const jwk = JSON.parse(atob(jwkStr)) as JsonWebKey;
    return crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  }

  private bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToBuffer(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

export const cryptoManager = new CryptoManager();
