import type { UUID } from "../types/index.js";
import { cryptoManager } from "./manager.js";

let activeUserId: UUID | null = null;

export function setActiveCryptoUserId(userId: UUID | null): void {
  if (activeUserId !== userId) {
    cryptoManager.clearAllConversationKeys();
  }
  activeUserId = userId;
}

export function getActiveCryptoUserId(): UUID | null {
  return activeUserId;
}

export function requireActiveCryptoUserId(): UUID {
  if (!activeUserId) {
    throw new Error("CRYPTO_USER_NOT_SET");
  }
  return activeUserId;
}
