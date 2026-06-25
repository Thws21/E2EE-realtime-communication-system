export type AppConfig = {
  port: number;
  nodeEnv: string;
  socketOrigins: string[];
  jwtAccessSecret: string;
  apiInternalBaseUrl: string;
  apiInternalToken: string;
  allowDevSocketAuth: boolean;
  allowDevConversationAccess: boolean;
  allowDevMessagePersist: boolean;
  callInviteTimeoutMs: number;
  staleCleanupIntervalMs: number;
  socketPingIntervalMs: number;
  socketPingTimeoutMs: number;
};

function readCsvEnv(value: string | undefined, fallback: string): string[] {
  return (value || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || "development";

  return {
    port: Number(process.env.PORT || 4000),
    nodeEnv,
    socketOrigins: readCsvEnv(
      process.env.SOCKET_CORS_ORIGINS || process.env.CLIENT_URL,
      "http://localhost",
    ),
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "",
    apiInternalBaseUrl: process.env.API_INTERNAL_BASE_URL || "http://api-service:3000",
    apiInternalToken: process.env.API_INTERNAL_TOKEN || "",
    allowDevSocketAuth: nodeEnv !== "production",
    allowDevConversationAccess:
      nodeEnv !== "production" && process.env.ALLOW_DEV_CONVERSATION_ACCESS === "true",
    allowDevMessagePersist: nodeEnv !== "production" && process.env.ALLOW_DEV_MESSAGE_PERSIST === "true",
    callInviteTimeoutMs: Number(process.env.CALL_INVITE_TIMEOUT_MS || 30_000),
    staleCleanupIntervalMs: Number(process.env.STALE_CLEANUP_INTERVAL_MS || 15_000),
    socketPingIntervalMs: Number(process.env.SOCKET_PING_INTERVAL_MS || 25_000),
    socketPingTimeoutMs: Number(process.env.SOCKET_PING_TIMEOUT_MS || 20_000),
  };
}
