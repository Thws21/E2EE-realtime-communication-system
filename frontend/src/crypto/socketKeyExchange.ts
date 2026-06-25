import type { UUID } from "../types/index.js";
import { socketManager } from "../socket/manager.js";
import { cryptoManager } from "./manager.js";
import { saveConversationKey } from "./conversationKeys.js";
import { shouldAllowSocketKeyExchange as defaultShouldAllowSocketKeyExchange } from "./gliteKeyGate.js";
import { generateUUID } from "../utils/uuid.js";

export type KeyExchangeInitEvent = Parameters<
  Parameters<typeof socketManager.onKeyExchangeInit>[0]
>[0];

export function createSocketKeyExchange(
  onKeyEstablished: (conversationId: UUID) => void,
  shouldAllowSocketKeyExchange: (conversationId: UUID) => boolean = defaultShouldAllowSocketKeyExchange,
) {
  async function handleIncomingKeyExchangeInit(event: KeyExchangeInitEvent): Promise<void> {
    if (!shouldAllowSocketKeyExchange(event.conversationId as UUID)) {
      return;
    }
    try {
      // Cross-init: smaller sessionProposalId wins as initiator.
      const myPending = socketManager.getPendingExchangeForConversation(event.conversationId);
      if (myPending) {
        if (myPending.sessionProposalId < event.sessionProposalId) {
          return;
        }
        socketManager.pendingKeyExchanges.delete(myPending.sessionProposalId);
      }

      const peerPublicKey = await cryptoManager.importEcdhPublicKey(event.publicKey);
      const keyPair = await cryptoManager.generateEcdhKeyPair();
      const sharedKey = await cryptoManager.deriveSharedKey(
        keyPair.privateKey,
        peerPublicKey,
        event.conversationId,
      );
      cryptoManager.setConversationKey(event.conversationId, 1, sharedKey);
      await saveConversationKey(event.conversationId, 1, sharedKey);

      const myPublicKeyBase64 = await cryptoManager.exportEcdhPublicKey(keyPair.publicKey);
      socketManager.respondToKeyExchange(
        event.conversationId,
        event.sessionProposalId,
        myPublicKeyBase64,
      );

      onKeyEstablished(event.conversationId);
    } catch (err) {
      console.error("[KeyExchange] Failed to respond to init:", err);
    }
  }

  function initiateKeyExchange(conversationId: UUID): Promise<void> {
    if (!shouldAllowSocketKeyExchange(conversationId)) {
      return Promise.reject(new Error("SOCKET_KEY_EXCHANGE_BLOCKED"));
    }
    return new Promise((resolve, reject) => {
      const sessionProposalId = generateUUID() as UUID;

      cryptoManager.generateEcdhKeyPair().then(async (keyPair) => {
        const myPublicKeyBase64 = await cryptoManager.exportEcdhPublicKey(keyPair.publicKey);

        socketManager.pendingKeyExchanges.set(sessionProposalId, {
          privateKey: keyPair.privateKey,
          conversationId,
        });

        let unsubscribe: () => void = () => {};

        const timeout = setTimeout(() => {
          socketManager.pendingKeyExchanges.delete(sessionProposalId);
          unsubscribe();
          if (cryptoManager.hasConversationKey(conversationId)) {
            resolve();
          } else {
            reject(new Error("KEY_EXCHANGE_TIMEOUT"));
          }
        }, 8000);

        unsubscribe = socketManager.onKeyExchangeResponse(async (response) => {
          if (response.sessionProposalId !== sessionProposalId) return;
          clearTimeout(timeout);
          unsubscribe();

          const pending = socketManager.pendingKeyExchanges.get(sessionProposalId);
          if (!pending || !response.accepted) {
            socketManager.pendingKeyExchanges.delete(sessionProposalId);
            if (cryptoManager.hasConversationKey(conversationId)) {
              resolve();
            } else {
              reject(new Error("KEY_EXCHANGE_DECLINED"));
            }
            return;
          }

          try {
            const peerPublicKey = await cryptoManager.importEcdhPublicKey(response.publicKey);
            const sharedKey = await cryptoManager.deriveSharedKey(
              pending.privateKey,
              peerPublicKey,
              conversationId,
            );
            cryptoManager.setConversationKey(conversationId, 1, sharedKey);
            await saveConversationKey(conversationId, 1, sharedKey);
            socketManager.pendingKeyExchanges.delete(sessionProposalId);
            onKeyEstablished(conversationId);
            resolve();
          } catch (err) {
            socketManager.pendingKeyExchanges.delete(sessionProposalId);
            reject(err);
          }
        });

        socketManager.initiateKeyExchange(conversationId, sessionProposalId, myPublicKeyBase64);
      });
    });
  }

  return { handleIncomingKeyExchangeInit, initiateKeyExchange };
}
