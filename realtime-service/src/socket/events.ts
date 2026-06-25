export type ClientEventEnvelope<TPayload> = {
  requestId: string;
  timestamp: string;
  payload: TPayload;
};

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidRegex.test(value);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readClientEvent<TPayload>(
  data: unknown,
  readPayload: (payload: Record<string, unknown>) => TPayload,
): ClientEventEnvelope<TPayload> {
  if (!isObject(data)) {
    throw new Error("VALIDATION_FAILED");
  }

  const requestId = data.requestId;
  const timestamp = data.timestamp;
  const payload = data.payload;

  if (!isUuid(requestId) || typeof timestamp !== "string" || !isObject(payload)) {
    throw new Error("VALIDATION_FAILED");
  }

  return {
    requestId,
    timestamp,
    payload: readPayload(payload),
  };
}

export function readRequestId(data: unknown): string | undefined {
  return isObject(data) && isUuid(data.requestId) ? data.requestId : undefined;
}
