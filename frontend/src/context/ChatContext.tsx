import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  UUID,
  Conversation,
  Message,
  Presence,
  CallLog,
  TimelineItem,
  E2eeSetupAad,
  ConversationLocalMeta,
  Timestamp,
} from "../types/index.js";
import { socketManager } from "../socket/manager.js";
import { cryptoManager } from "../crypto/manager.js";
import {
  decryptMessage as decryptMessageWithKeys,
  ensureKeyForSend,
  ensureKeyFromGliteHistory,
  conversationHasGliteSetup,
  hasConversationKey,
  isE2eeSetupAad,
  loadConversationKey,
  PeerPrekeyMissingError,
  setActiveCryptoUserId,
} from "../crypto/conversationKeys.js";
import {
  configureGliteKeyGate,
  markGliteConversation,
  shouldAllowSocketKeyExchange,
} from "../crypto/gliteKeyGate.js";
import { createSocketKeyExchange } from "../crypto/socketKeyExchange.js";
import { apiClient } from "../api/client.js";
import { generateUUID } from "../utils/uuid.js";
import { getJwtClaim } from "../utils/jwt.js";
import { useAuth } from "./AuthContext.js";
import {
  applyConversationPatch,
  patchMessageInConversation,
  type ConversationMaps,
} from "../chat/applyConversationPatch.js";
import {
  buildPreviewText,
  getSortedVisibleConversations,
  truncatePreview,
} from "../chat/conversationList.js";
import { createOptimisticMessage, withOutboundStatus } from "../chat/optimisticMessage.js";
import { loadOutbox, saveOutbox, type PendingQueueEntry } from "../chat/outbox.js";

interface ChatContextValue {
  conversations: Map<UUID, Conversation>;
  visibleConversations: Conversation[];
  messages: Map<UUID, Message[]>;
  calls: Map<UUID, CallLog[]>;
  timeline: Map<UUID, TimelineItem[]>;
  presences: Map<UUID, Presence>;
  currentConversationId: UUID | null;
  setCurrentConversationId: (id: UUID | null) => void;
  loadConversations: () => Promise<void>;
  loadMessages: (conversationId: UUID) => Promise<void>;
  sendMessage: (conversationId: UUID, plaintext: string) => Promise<void>;
  retryMessage: (conversationId: UUID, clientTempId: UUID) => Promise<void>;
  subscribeToPresence: (userIds: UUID[]) => Promise<void>;
  markConversationOpenedByMe: (conversationId: UUID) => void;
  getConversationPreview: (conversationId: UUID) => { preview?: string; sentAt?: Timestamp };
  keyReadyConversations: Set<UUID>;
}

function markOptimisticSendFailed(
  conversationId: UUID,
  clientTempId: UUID,
  messagesByConversation: Map<UUID, Message[]>,
  commit: (conversationId: UUID, patch: { messages?: Message[] }) => void,
): void {
  const current = messagesByConversation.get(conversationId) ?? [];
  commit(conversationId, {
    messages: patchMessageInConversation(current, clientTempId, (m) =>
      withOutboundStatus(m, "failed"),
    ),
  });
}

export const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user, accessToken } = useAuth();
  const [conversations, setConversations] = useState<Map<UUID, Conversation>>(new Map());
  const [messages, setMessages] = useState<Map<UUID, Message[]>>(new Map());
  const [calls, setCalls] = useState<Map<UUID, CallLog[]>>(new Map());
  const [timeline, setTimeline] = useState<Map<UUID, TimelineItem[]>>(new Map());
  const [presences, setPresences] = useState<Map<UUID, Presence>>(new Map());
  const [currentConversationId, setCurrentConversationId] = useState<UUID | null>(null);
  const [keyReadyConversations, setKeyReadyConversations] = useState<Set<UUID>>(new Set());
  const [conversationLocalMeta, setConversationLocalMeta] = useState<
    Map<UUID, ConversationLocalMeta>
  >(new Map());

  const messageSeqRef = useRef<Map<UUID, number>>(new Map());
  const subscribedUsersRef = useRef<Set<UUID>>(new Set());
  const messagesRef = useRef<Map<UUID, Message[]>>(messages);
  const callsRef = useRef<Map<UUID, CallLog[]>>(calls);
  const conversationsRef = useRef<Map<UUID, Conversation>>(conversations);
  const pendingQueueRef = useRef<Map<UUID, PendingQueueEntry[]>>(new Map());
  const pendingSetupAadRef = useRef<Map<UUID, E2eeSetupAad>>(new Map());
  const exchangeInProgressRef = useRef<Set<UUID>>(new Set());
  const conversationLocalMetaRef = useRef<Map<UUID, ConversationLocalMeta>>(conversationLocalMeta);
  const currentConversationIdRef = useRef<UUID | null>(currentConversationId);

  useEffect(() => {
    configureGliteKeyGate((conversationId) => messagesRef.current.get(conversationId));
  });

  useEffect(() => {
    if (user) {
      setActiveCryptoUserId(user.userId);
    }
  }, [user]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    callsRef.current = calls;
  }, [calls]);
  useEffect(() => {
    conversationLocalMetaRef.current = conversationLocalMeta;
  }, [conversationLocalMeta]);
  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

  // Tab title kieu Messenger: "(N) E2EE Chat" khi co tin chua doc.
  useEffect(() => {
    let total = 0;
    for (const conv of conversations.values()) total += conv.unreadCount;
    document.title = total > 0 ? `(${total}) E2EE Chat` : "E2EE Chat";
  }, [conversations]);

  const adjustUnread = useCallback((conversationId: UUID, delta: number | "reset") => {
    setConversations((prev) => {
      const conv = prev.get(conversationId);
      if (!conv) return prev;
      const nextCount = delta === "reset" ? 0 : Math.max(0, conv.unreadCount + delta);
      if (nextCount === conv.unreadCount) return prev;
      return new Map(prev).set(conversationId, { ...conv, unreadCount: nextCount });
    });
  }, []);

  const commitConversation = useCallback(
    (conversationId: UUID, patch: { messages?: Message[]; calls?: CallLog[] }) => {
      setMessages((mPrev) => {
        const maps: ConversationMaps = {
          messages: mPrev,
          calls: callsRef.current,
          timeline: new Map(),
        };
        const next = applyConversationPatch(maps, conversationId, patch);
        setCalls(next.calls);
        setTimeline(next.timeline);
        messagesRef.current = next.messages;
        callsRef.current = next.calls;
        return next.messages;
      });
    },
    [],
  );

  const patchConversationMeta = useCallback(
    (conversationId: UUID, patch: Partial<ConversationLocalMeta>) => {
      setConversationLocalMeta((prev) => {
        const next = new Map(prev);
        const existing = next.get(conversationId) ?? {};
        next.set(conversationId, { ...existing, ...patch });
        return next;
      });
    },
    [],
  );

  const syncPreviewFromMessages = useCallback(
    (conversationId: UUID, convMessages: Message[]) => {
      const last = [...convMessages].reverse().find((m) => m.plaintext);
      if (!last?.plaintext) return;
      patchConversationMeta(conversationId, {
        hasLocalActivity: true,
        lastPreview: truncatePreview(last.plaintext),
        lastActivityAt: last.createdAt,
      });
    },
    [patchConversationMeta],
  );

  const markConversationOpenedByMe = useCallback(
    (conversationId: UUID) => {
      patchConversationMeta(conversationId, { openedByMe: true });
    },
    [patchConversationMeta],
  );

  const getConversationPreview = useCallback(
    (conversationId: UUID) => {
      const conv = conversations.get(conversationId);
      if (!conv) return {};
      return buildPreviewText(conv, conversationLocalMeta.get(conversationId));
    },
    [conversations, conversationLocalMeta],
  );

  const visibleConversations = useMemo(
    () => getSortedVisibleConversations(conversations, conversationLocalMeta),
    [conversations, conversationLocalMeta],
  );

  const refreshConversationDecryption = useCallback(
    (conversationId: UUID) => {
      const existing = messagesRef.current.get(conversationId) || [];
      void (async () => {
        // Sequential decrypt: shared in-memory key slot is not concurrency-safe.
        const decrypted: Message[] = [];
        for (const m of existing) {
          decrypted.push(await decryptMessageWithKeys(m));
        }
        commitConversation(conversationId, { messages: decrypted });
        syncPreviewFromMessages(conversationId, decrypted);
      })();
    },
    [commitConversation, syncPreviewFromMessages],
  );

  const markKeyReady = useCallback((conversationId: UUID) => {
    setKeyReadyConversations((prev) => new Set(prev).add(conversationId));
  }, []);

  const socketKeyExchange = useMemo(
    () =>
      createSocketKeyExchange((conversationId) => {
        markKeyReady(conversationId as UUID);
        refreshConversationDecryption(conversationId);
      }),
    [refreshConversationDecryption, markKeyReady],
  );

  const persistOutbox = useCallback(() => {
    if (!user) return;
    saveOutbox(user.userId, pendingQueueRef.current);
  }, [user]);

  const ensureSocketKeyExchange = useCallback(
    (conversationId: UUID) => {
      if (!shouldAllowSocketKeyExchange(conversationId)) return;
      if (hasConversationKey(conversationId)) return;
      if (socketManager.getPendingExchangeForConversation(conversationId)) return;
      if (exchangeInProgressRef.current.has(conversationId)) return;
      exchangeInProgressRef.current.add(conversationId);
      socketKeyExchange
        .initiateKeyExchange(conversationId)
        .catch((err) => console.warn("[KeyExchange] establish failed:", err))
        .finally(() => exchangeInProgressRef.current.delete(conversationId));
    },
    [socketKeyExchange],
  );

  const processOutbox = useCallback(async () => {
    for (const conversationId of pendingQueueRef.current.keys()) {
      if (hasConversationKey(conversationId)) {
        markKeyReady(conversationId);
        continue;
      }
      try {
        await socketManager.joinConversation(conversationId);
      } catch (err) {
        console.warn("[Outbox] join failed:", err);
      }
      ensureSocketKeyExchange(conversationId);
    }
  }, [markKeyReady, ensureSocketKeyExchange]);

  const decryptMessage = useCallback(
    (message: Message) => decryptMessageWithKeys(message),
    [],
  );

  const doActualSend = useCallback(
    async (
      conversationId: UUID,
      plaintext: string,
      clientTempId: UUID,
      wireAad?: Record<string, unknown>,
    ) => {
      if (!user) return;

      const existing = messagesRef.current.get(conversationId) ?? [];
      commitConversation(conversationId, {
        messages: patchMessageInConversation(existing, clientTempId, (m) =>
          withOutboundStatus(m, "sending"),
        ),
      });

      try {
        const currentSeq = messageSeqRef.current.get(conversationId) || 0;
        const clientMessageSeq = currentSeq + 1;
        messageSeqRef.current.set(conversationId, clientMessageSeq);

        const keyVersion = 1;
        const wireAadToSend = wireAad ? { ...wireAad } : undefined;

        const encrypted = await cryptoManager.encrypt(conversationId, plaintext, keyVersion);
        const messageId = generateUUID() as UUID;

        await socketManager.sendMessage({
          conversationId,
          messageId,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          algorithm: "aes-256-gcm",
          keyVersion,
          clientMessageSeq,
          ...(wireAadToSend ? { aad: wireAadToSend } : {}),
        });

        const sentMessage: Message = {
          messageId,
          clientTempId,
          conversationId,
          senderUserId: user.userId,
          senderUsername: user.username,
          senderDisplayName: user.displayName,
          senderAvatarUrl: user.avatarUrl,
          envelope: {
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce,
            algorithm: "aes-256-gcm",
            keyVersion,
            clientMessageSeq,
            ...(wireAadToSend ? { aad: wireAadToSend } : {}),
          },
          plaintext,
          outboundStatus: "sent",
          deliveredTo: [],
          readBy: [],
          createdAt: new Date().toISOString() as Message["createdAt"],
        };

        const current = messagesRef.current.get(conversationId) ?? [];
        const exists = current.some(
          (m) => m.clientTempId === clientTempId || m.messageId === clientTempId,
        );
        commitConversation(conversationId, {
          messages: exists
            ? patchMessageInConversation(current, clientTempId, () => sentMessage)
            : [...current, sentMessage],
        });
        patchConversationMeta(conversationId, {
          hasLocalActivity: true,
          lastPreview: truncatePreview(plaintext),
          lastActivityAt: sentMessage.createdAt,
        });

      } catch (err) {
        const current = messagesRef.current.get(conversationId) ?? [];
        commitConversation(conversationId, {
          messages: patchMessageInConversation(current, clientTempId, (m) =>
            withOutboundStatus(m, "failed"),
          ),
        });
        throw err;
      }
    },
    [user, commitConversation, patchConversationMeta],
  );

  const flushPendingQueue = useCallback(
    async (conversationId: UUID) => {
      const queue = pendingQueueRef.current.get(conversationId);
      if (!queue?.length) return;
      pendingQueueRef.current.delete(conversationId);
      persistOutbox();
      const setupAad = pendingSetupAadRef.current.get(conversationId);
      for (let i = 0; i < queue.length; i += 1) {
        const entry = queue[i]!;
        const wireAad =
          i === 0 && setupAad ? ({ ...setupAad } as Record<string, unknown>) : undefined;
        try {
          await doActualSend(conversationId, entry.plaintext, entry.clientTempId, wireAad);
        } catch (err) {
          console.error("[Queue] send failed for queued message:", err);
        }
      }
      if (setupAad) {
        pendingSetupAadRef.current.delete(conversationId);
      }
    },
    [doActualSend, persistOutbox],
  );

  useEffect(() => {
    for (const conversationId of keyReadyConversations) {
      const queue = pendingQueueRef.current.get(conversationId as UUID);
      if (!queue?.length) continue;
      void flushPendingQueue(conversationId as UUID).catch((err) =>
        console.error("[Queue] Failed to flush queued messages:", err),
      );
    }
  }, [keyReadyConversations, flushPendingQueue]);

  const appendOptimisticMessage = useCallback(
    (conversationId: UUID, clientTempId: UUID, plaintext: string, createdAt?: Timestamp) => {
      if (!user) return;
      const optimistic = createOptimisticMessage(
        conversationId,
        clientTempId,
        user,
        plaintext,
        createdAt,
      );
      const existing = messagesRef.current.get(conversationId) ?? [];
      commitConversation(conversationId, { messages: [...existing, optimistic] });
      patchConversationMeta(conversationId, {
        hasLocalActivity: true,
        lastPreview: truncatePreview(plaintext),
        lastActivityAt: optimistic.createdAt,
      });
    },
    [user, commitConversation, patchConversationMeta],
  );

  const loadConversations = useCallback(async () => {
    if (!user || !accessToken) return;
    try {
      const result = await apiClient.getConversations(50);
      setConversations((prev) => {
        const updated = new Map(prev);
        for (const conv of result.conversations) {
          updated.set(conv.conversationId, conv);
        }
        return updated;
      });
    } catch (err) {
      console.error("Failed to load conversations:", err);
    }
  }, [user, accessToken]);

  // Load outbox before onConnect registers processOutbox.
  useEffect(() => {
    if (!user) return;
    const restored = loadOutbox(user.userId);
    if (restored.size === 0) return;
    pendingQueueRef.current = restored;
    for (const [conversationId, entries] of restored) {
      const existing = messagesRef.current.get(conversationId) ?? [];
      const known = new Set(existing.map((m) => m.clientTempId ?? m.messageId));
      const optimistic = entries
        .filter((e) => !known.has(e.clientTempId))
        .map((e) =>
          createOptimisticMessage(conversationId, e.clientTempId, user, e.plaintext, e.createdAt),
        );
      if (optimistic.length > 0) {
        commitConversation(conversationId, { messages: [...existing, ...optimistic] });
      }
      const last = entries[entries.length - 1];
      if (last) {
        patchConversationMeta(conversationId, {
          hasLocalActivity: true,
          lastPreview: truncatePreview(last.plaintext),
          lastActivityAt: last.createdAt,
        });
      }
    }
  }, [user, commitConversation, patchConversationMeta]);

  useEffect(() => {
    if (!user) return;
    return socketManager.onConnect(() => {
      void processOutbox();
    });
  }, [user, processOutbox]);

  useEffect(() => {
    if (!user || !accessToken) return;

    const unsubPresence = socketManager.onPresenceUpdate((presence) => {
      setPresences((prev) => new Map(prev).set(presence.userId, presence));
    });

    const unsubMessage = socketManager.onChatMessage(async (message) => {
      const conversation = conversationsRef.current.get(message.conversationId);
      const sender = conversation?.members.find((m) => m.userId === message.senderUserId);
      const enriched: Message = {
        ...message,
        senderUsername: sender?.username ?? message.senderUsername ?? "",
        senderDisplayName: sender?.displayName ?? message.senderDisplayName ?? "",
        senderAvatarUrl: sender?.avatarUrl ?? message.senderAvatarUrl,
      };
      const decrypted = await decryptMessage(enriched);
      if (isE2eeSetupAad(decrypted.envelope.aad) && decrypted.plaintext) {
        markGliteConversation(decrypted.conversationId);
      }

      const existing = messagesRef.current.get(message.conversationId) || [];
      if (existing.some((m) => m.messageId === decrypted.messageId)) return;

      const nextMessages = [...existing, decrypted];
      commitConversation(message.conversationId, { messages: nextMessages });
      if (decrypted.plaintext) {
        patchConversationMeta(message.conversationId, {
          hasLocalActivity: true,
          lastPreview: truncatePreview(decrypted.plaintext),
          lastActivityAt: decrypted.createdAt,
        });
      }

      if (user && decrypted.senderUserId !== user.userId) {
        void apiClient
          .markMessageDelivered(decrypted.messageId, new Date().toISOString())
          .catch(() => undefined);
        socketManager.markDelivered(message.conversationId, decrypted.messageId);

        if (currentConversationIdRef.current === message.conversationId) {
          const readAt = new Date().toISOString();
          void apiClient
            .markConversationRead(message.conversationId, decrypted.messageId, readAt)
            .catch(() => undefined);
          socketManager.markRead(message.conversationId, [decrypted.messageId]);
        } else {
          adjustUnread(message.conversationId, 1);
        }
      }
    });

    const unsubReceipt = socketManager.onMessageReceipt((evt) => {
      const existing = messagesRef.current.get(evt.conversationId);
      if (!existing) return;
      const targetIds = new Set(evt.messageIds);
      const updated = existing.map((m) => {
        if (!targetIds.has(m.messageId)) return m;
        if (evt.status === "delivered") {
          if (m.deliveredTo.includes(evt.userId)) return m;
          return { ...m, deliveredTo: [...m.deliveredTo, evt.userId] };
        }
        const deliveredTo = m.deliveredTo.includes(evt.userId)
          ? m.deliveredTo
          : [...m.deliveredTo, evt.userId];
        const readBy = m.readBy.includes(evt.userId) ? m.readBy : [...m.readBy, evt.userId];
        return { ...m, deliveredTo, readBy };
      });
      commitConversation(evt.conversationId, { messages: updated });
    });

    const unsubKeyInit = socketManager.onKeyExchangeInit(
      socketKeyExchange.handleIncomingKeyExchangeInit,
    );

    const unsubPeerJoined = socketManager.onPeerJoined((event) => {
      ensureSocketKeyExchange(event.conversationId as UUID);
    });

    const unsubCallLogged = socketManager.onCallLogged((call) => {
      const existing = callsRef.current.get(call.conversationId) || [];
      if (existing.some((c) => c.callId === call.callId)) return;
      const nextCalls = [...existing, call];
      const convMessages = messagesRef.current.get(call.conversationId) || [];
      commitConversation(call.conversationId, { messages: convMessages, calls: nextCalls });
    });

    const unsubConversationCreated = socketManager.onConversationCreated((event) => {
      void loadConversations();
      if (shouldAllowSocketKeyExchange(event.conversationId)) {
        void socketManager.joinConversation(event.conversationId);
      }
    });

    return () => {
      unsubPresence();
      unsubMessage();
      unsubReceipt();
      unsubKeyInit();
      unsubPeerJoined();
      unsubCallLogged();
      unsubConversationCreated();
    };
  }, [
    user,
    accessToken,
    decryptMessage,
    socketKeyExchange,
    ensureSocketKeyExchange,
    loadConversations,
    commitConversation,
    patchConversationMeta,
    adjustUnread,
    markKeyReady,
  ]);

  const loadMessages = useCallback(
    async (conversationId: UUID) => {
      if (!user) return;
      try {
        // Join in parallel with fetch to avoid missing live messages mid-load.
        const joinPromise = socketManager
          .joinConversation(conversationId)
          .catch((err) => console.warn("[Chat] joinConversation failed:", err));

        const [messageResult, callResult] = await Promise.all([
          apiClient.getMessages(conversationId, 50),
          apiClient.getCalls(conversationId, 50),
        ]);

        const hasGlite = conversationHasGliteSetup(messageResult.messages);
        const gliteKeyOk = await ensureKeyFromGliteHistory(
          conversationId,
          messageResult.messages,
        );

        if (gliteKeyOk) {
          markGliteConversation(conversationId);
        } else if (hasGlite) {
          // History has G-lite setup but no key yet (e.g. this device wasn't a fan-out
          // target). Mark it G-lite but never wipe a working key — keys are additive.
          markGliteConversation(conversationId);
        } else if (!hasConversationKey(conversationId)) {
          await loadConversationKey(conversationId, 1);
        }

        if (hasConversationKey(conversationId)) {
          markKeyReady(conversationId);
        }

        const decrypted: Message[] = [];
        for (const m of messageResult.messages) {
          decrypted.push(await decryptMessage(m));
        }

        // Re-merge pending outbox entries after server load.
        const pending = pendingQueueRef.current.get(conversationId) ?? [];
        const serverIds = new Set(decrypted.map((m) => m.messageId));
        const pendingMsgs = pending
          .filter((e) => !serverIds.has(e.clientTempId))
          .map((e) =>
            createOptimisticMessage(conversationId, e.clientTempId, user, e.plaintext, e.createdAt),
          );
        const merged = pendingMsgs.length > 0 ? [...decrypted, ...pendingMsgs] : decrypted;

        commitConversation(conversationId, {
          messages: merged,
          calls: callResult.calls,
        });
        syncPreviewFromMessages(conversationId, merged);
        adjustUnread(conversationId, "reset");

        await joinPromise;

        if (pending.length > 0 && !hasConversationKey(conversationId)) {
          ensureSocketKeyExchange(conversationId);
        }

        const lastFromPeer = [...decrypted].reverse().find((m) => m.senderUserId !== user.userId);
        if (lastFromPeer) {
          const readAt = new Date().toISOString();
          void apiClient
            .markConversationRead(conversationId, lastFromPeer.messageId, readAt)
            .catch(() => undefined);
          socketManager.markRead(conversationId, [lastFromPeer.messageId]);
        }
      } catch (err) {
        console.error("Failed to load messages:", err);
      }
    },
    [
      user,
      decryptMessage,
      markKeyReady,
      commitConversation,
      syncPreviewFromMessages,
      adjustUnread,
      ensureSocketKeyExchange,
    ],
  );

  const sendMessage = useCallback(
    async (conversationId: UUID, plaintext: string) => {
      if (!user || !accessToken) return;

      const conversation = conversationsRef.current.get(conversationId);
      const peer = conversation?.members.find((m) => m.userId !== user.userId);
      if (!peer) {
        throw new Error("Không tìm thấy người nhận trong cuộc trò chuyện.");
      }

      const clientTempId = generateUUID() as UUID;
      const createdAt = new Date().toISOString() as Timestamp;
      appendOptimisticMessage(conversationId, clientTempId, plaintext, createdAt);

      const deviceId = getJwtClaim(accessToken, "deviceId") as UUID | undefined;
      if (!deviceId) {
        markOptimisticSendFailed(
          conversationId,
          clientTempId,
          messagesRef.current,
          commitConversation,
        );
        throw new Error("Phiên đăng nhập không hợp lệ (thiếu deviceId).");
      }

      if (!hasConversationKey(conversationId)) {
        // Reuse G-lite key from history before minting a new one.
        await ensureKeyFromGliteHistory(
          conversationId,
          messagesRef.current.get(conversationId) ?? [],
        );
      }

      let setupAad: Awaited<ReturnType<typeof ensureKeyForSend>>["setupAad"];
      try {
        const result = await ensureKeyForSend(conversationId, peer.userId, deviceId);
        setupAad = result.setupAad;
        if (setupAad) {
          pendingSetupAadRef.current.set(conversationId, setupAad);
          markGliteConversation(conversationId);
        }
      } catch (err) {
        if (err instanceof PeerPrekeyMissingError) {
          ensureSocketKeyExchange(conversationId);
        } else {
          markOptimisticSendFailed(
            conversationId,
            clientTempId,
            messagesRef.current,
            commitConversation,
          );
          throw err;
        }
      }

      if (!hasConversationKey(conversationId)) {
        const queue = pendingQueueRef.current.get(conversationId) ?? [];
        queue.push({ clientTempId, plaintext, createdAt });
        pendingQueueRef.current.set(conversationId, queue);
        persistOutbox();
        return;
      }

      markKeyReady(conversationId);
      await flushPendingQueue(conversationId);

      const wireAad = setupAad ? { ...setupAad } : undefined;
      if (wireAad) {
        pendingSetupAadRef.current.delete(conversationId);
      }
      await doActualSend(conversationId, plaintext, clientTempId, wireAad);
    },
    [
      user,
      accessToken,
      ensureSocketKeyExchange,
      markKeyReady,
      doActualSend,
      flushPendingQueue,
      appendOptimisticMessage,
      commitConversation,
      persistOutbox,
    ],
  );

  const retryMessage = useCallback(
    async (conversationId: UUID, clientTempId: UUID) => {
      const msgs = messagesRef.current.get(conversationId) ?? [];
      const target = msgs.find((m) => (m.clientTempId ?? m.messageId) === clientTempId);
      if (!target?.plaintext) return;

      if (!hasConversationKey(conversationId)) {
        // Chua co khoa -> dua lai vao hang doi, hien "dang cho", thu thiet lap khoa.
        const queue = pendingQueueRef.current.get(conversationId) ?? [];
        if (!queue.some((e) => e.clientTempId === clientTempId)) {
          queue.push({ clientTempId, plaintext: target.plaintext, createdAt: target.createdAt });
          pendingQueueRef.current.set(conversationId, queue);
          persistOutbox();
        }
        commitConversation(conversationId, {
          messages: patchMessageInConversation(msgs, clientTempId, (m) =>
            withOutboundStatus(m, "pending_key"),
          ),
        });
        ensureSocketKeyExchange(conversationId);
        return;
      }

      await doActualSend(conversationId, target.plaintext, clientTempId);
    },
    [doActualSend, persistOutbox, ensureSocketKeyExchange, commitConversation],
  );

  const subscribeToPresence = useCallback(async (userIds: UUID[]) => {
    const newIds = userIds.filter((id) => !subscribedUsersRef.current.has(id));
    if (newIds.length === 0) return;
    try {
      await socketManager.subscribePresence(newIds);
      newIds.forEach((id) => subscribedUsersRef.current.add(id));
    } catch (err) {
      console.error("Failed to subscribe to presence:", err);
    }
  }, []);

  const value: ChatContextValue = {
    conversations,
    visibleConversations,
    messages,
    calls,
    timeline,
    presences,
    currentConversationId,
    setCurrentConversationId,
    loadConversations,
    loadMessages,
    sendMessage,
    retryMessage,
    subscribeToPresence,
    markConversationOpenedByMe,
    getConversationPreview,
    keyReadyConversations,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = React.useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within ChatProvider");
  }
  return context;
}
