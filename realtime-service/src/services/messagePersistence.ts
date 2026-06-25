import type { AppConfig } from "../config.js";

export type MessageEnvelope = {
  ciphertext: string;
  nonce: string;
  algorithm: "aes-256-gcm";
  keyVersion: number;
  aad?: Record<string, unknown>;
  clientMessageSeq: number;
};

export type PersistMessageInput = {
  requestId: string;
  messageId: string;
  conversationId: string;
  senderUserId: string;
  senderDeviceId: string;
  envelope: MessageEnvelope;
};

export type PersistMessageResult = {
  stored: boolean;
  createdAt: string;
  deduped: boolean;
};

export type MessagePersistenceService = {
  persistMessage(input: PersistMessageInput): Promise<PersistMessageResult>;
};

type ApiPersistResponse = {
  success?: boolean;
  data?: {
    stored?: unknown;
    createdAt?: unknown;
    deduped?: unknown;
  };
};

function readApiPersistResponse(data: ApiPersistResponse): PersistMessageResult {
  if (
    data.success !== true ||
    typeof data.data?.stored !== "boolean" ||
    typeof data.data.createdAt !== "string" ||
    typeof data.data.deduped !== "boolean"
  ) {
    throw new Error("INVALID_API_RESPONSE");
  }

  return {
    stored: data.data.stored,
    createdAt: data.data.createdAt,
    deduped: data.data.deduped,
  };
}

export function createMessagePersistenceService(config: AppConfig): MessagePersistenceService {
  return {
    async persistMessage(input) {
      if (config.allowDevMessagePersist) {
        return {
          stored: true,
          createdAt: new Date().toISOString(),
          deduped: false,
        };
      }

      const response = await fetch(`${config.apiInternalBaseUrl}/api/v1/internal/messages/persist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiInternalToken}`,
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(`API_PERSIST_FAILED_${response.status}`);
      }

      return readApiPersistResponse((await response.json()) as ApiPersistResponse);
    },
  };
}
