import type { AppConfig } from "../config.js";
import type { CallRecord } from "../stores/callStore.js";

export type CallPersistStatus = "missed" | "rejected" | "completed" | "ended";

export type CallPersistPayload = {
  callId: string;
  conversationId: string;
  callerId: string;
  callType: "voice" | "video";
  status: CallPersistStatus;
  startedAt?: string;
  endedAt?: string;
};

export type CallLoggedEvent = {
  callId: string;
  conversationId: string;
  callerId: string;
  callType: "voice" | "video";
  status: CallPersistStatus;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  createdAt: string;
};

export type CallPersistenceService = {
  persistCall(payload: CallPersistPayload): Promise<{ createdAt: string } | null>;
};

export function deriveCallStatus(
  eventName: "call:reject" | "call:end",
  call: CallRecord,
  reason?: string,
): CallPersistStatus {
  if (eventName === "call:reject") {
    return "rejected";
  }
  if (reason === "timeout" || call.status === "ringing") {
    return "missed";
  }
  if (call.status === "active" || call.acceptedByUserId) {
    return "completed";
  }
  return "ended";
}

export function buildCallPersistPayload(
  call: CallRecord,
  eventName: "call:reject" | "call:end",
  reason?: string,
): CallPersistPayload {
  const status = deriveCallStatus(eventName, call, reason);
  const endedAt = new Date().toISOString();
  const startedAt =
    status === "completed" && call.acceptedAt
      ? call.acceptedAt
      : undefined;

  return {
    callId: call.callId,
    conversationId: call.conversationId,
    callerId: call.callerUserId,
    callType: call.callType,
    status,
    ...(startedAt ? { startedAt } : {}),
    endedAt,
  };
}

export function toCallLoggedEvent(
  payload: CallPersistPayload,
  createdAt: string,
): CallLoggedEvent {
  const startedMs = payload.startedAt ? Date.parse(payload.startedAt) : null;
  const endedMs = payload.endedAt ? Date.parse(payload.endedAt) : null;
  const durationSec =
    startedMs !== null && endedMs !== null && endedMs >= startedMs
      ? Math.round((endedMs - startedMs) / 1000)
      : null;

  return {
    callId: payload.callId,
    conversationId: payload.conversationId,
    callerId: payload.callerId,
    callType: payload.callType,
    status: payload.status,
    startedAt: payload.startedAt ?? null,
    endedAt: payload.endedAt ?? null,
    durationSec,
    createdAt,
  };
}

type ApiPersistResponse = {
  success?: boolean;
  data?: { createdAt?: unknown };
};

export function createCallPersistenceService(config: AppConfig): CallPersistenceService {
  return {
    async persistCall(payload) {
      const response = await fetch(`${config.apiInternalBaseUrl}/api/v1/internal/calls/persist`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiInternalToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error("[callPersistence] API persist failed", response.status);
        return null;
      }

      const body = (await response.json()) as ApiPersistResponse;
      if (body.success !== true || typeof body.data?.createdAt !== "string") {
        return null;
      }
      return { createdAt: body.data.createdAt };
    },
  };
}
