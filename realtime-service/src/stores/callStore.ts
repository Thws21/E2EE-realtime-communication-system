export type CallType = "voice" | "video";
export type CallStatus = "ringing" | "active" | "ended";

export type CallRecord = {
  callId: string;
  conversationId: string;
  callerUserId: string;
  callerDeviceId: string;
  callType: CallType;
  status: CallStatus;
  createdAt: string;
  expiresAt: string;
  acceptedByUserId?: string;
  acceptedAt?: string;
  endedAt?: string;
};

export class CallStore {
  private readonly callsById = new Map<string, CallRecord>();

  constructor(private readonly ringingTtlMs = 45 * 1000) {}

  startCall(input: {
    callId: string;
    conversationId: string;
    callerUserId: string;
    callerDeviceId: string;
    callType: CallType;
  }): CallRecord {
    const existing = this.callsById.get(input.callId);
    if (existing && existing.status !== "ended") {
      throw new Error("CALL_STATE_CONFLICT");
    }

    const now = Date.now();
    const record: CallRecord = {
      ...input,
      status: "ringing",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ringingTtlMs).toISOString(),
    };

    this.callsById.set(input.callId, record);
    return record;
  }

  acceptCall(callId: string, userId: string): CallRecord {
    const call = this.requireActiveCall(callId);
    if (call.status !== "ringing") {
      throw new Error("CALL_STATE_CONFLICT");
    }

    const updated: CallRecord = {
      ...call,
      status: "active",
      acceptedByUserId: userId,
      acceptedAt: new Date().toISOString(),
    };

    this.callsById.set(callId, updated);
    return updated;
  }

  endCall(callId: string): CallRecord {
    const call = this.requireActiveCall(callId);
    const updated: CallRecord = {
      ...call,
      status: "ended",
      endedAt: new Date().toISOString(),
    };

    this.callsById.set(callId, updated);
    return updated;
  }

  getCall(callId: string): CallRecord | undefined {
    return this.callsById.get(callId);
  }

  getRingingCallForConversation(conversationId: string): CallRecord | undefined {
    // Tim call dang do chuong de gui lai cho user vua join room.
    for (const call of this.callsById.values()) {
      if (call.conversationId === conversationId && call.status === "ringing") {
        return call;
      }
    }

    return undefined;
  }

  cleanupExpiredRingingCalls(): CallRecord[] {
    const now = Date.now();
    const expired: CallRecord[] = [];

    for (const [callId, call] of this.callsById.entries()) {
      if (call.status === "ringing" && Date.parse(call.expiresAt) <= now) {
        const ended: CallRecord = {
          ...call,
          status: "ended",
          endedAt: new Date(now).toISOString(),
        };
        this.callsById.set(callId, ended);
        expired.push(ended);
      }
    }

    return expired;
  }

  getStats() {
    let ringingCount = 0;
    let activeCount = 0;

    for (const call of this.callsById.values()) {
      if (call.status === "ringing") {
        ringingCount += 1;
      }
      if (call.status === "active") {
        activeCount += 1;
      }
    }

    return {
      callCount: this.callsById.size,
      ringingCount,
      activeCount,
      ringingTtlMs: this.ringingTtlMs,
    };
  }

  private requireActiveCall(callId: string): CallRecord {
    const call = this.callsById.get(callId);
    if (!call || call.status === "ended") {
      throw new Error("CALL_STATE_CONFLICT");
    }

    return call;
  }
}
