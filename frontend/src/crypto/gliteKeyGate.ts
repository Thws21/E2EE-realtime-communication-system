import type { Message, UUID } from "../types/index.js";
import { conversationHasGliteSetup } from "./conversationKeys.js";

const gliteConversationIds = new Set<UUID>();
let messageLookup: (conversationId: UUID) => Message[] | undefined = () => undefined;

export function configureGliteKeyGate(
  lookup: (conversationId: UUID) => Message[] | undefined,
): void {
  messageLookup = lookup;
}

export function markGliteConversation(conversationId: UUID): void {
  gliteConversationIds.add(conversationId);
}

export function shouldAllowSocketKeyExchange(conversationId: UUID): boolean {
  if (gliteConversationIds.has(conversationId)) return false;
  const cached = messageLookup(conversationId);
  if (cached && conversationHasGliteSetup(cached)) return false;
  return true;
}
