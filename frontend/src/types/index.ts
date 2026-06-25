export type UUID = string & { readonly __uuid: unique symbol };
export type Timestamp = string & { readonly __timestamp: unique symbol };

export function isValidUUID(value: string): value is UUID {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

export function createUUID(value: string): UUID {
  if (!isValidUUID(value)) {
    throw new Error(`Invalid UUID: ${value}`);
  }
  return value as UUID;
}

export interface User {
  userId: UUID;
  username: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  createdAt: Timestamp;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

export interface AuthContext {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  error: string | null;
  prekeyUploadFailed: boolean;
}

export type PendingSendReason = "awaiting_peer_prekey" | "awaiting_key_exchange";

export type OutboundStatus = "pending_key" | "sending" | "sent" | "failed";

export interface ConversationLocalMeta {
  lastPreview?: string;
  lastActivityAt?: Timestamp;
  openedByMe?: boolean;
  hasLocalActivity?: boolean;
}

export interface DeviceInfo {
  userAgent: string;
  platform: string;
  deviceName: string;
}

export const ConversationType = {
  DIRECT: "DIRECT",
  GROUP: "GROUP",
} as const;
export type ConversationType = typeof ConversationType[keyof typeof ConversationType];

export interface ConversationMember {
  userId: UUID;
  username: string;
  displayName: string;
  avatarUrl?: string;
  joinedAt: Timestamp;
}

export interface Conversation {
  conversationId: UUID;
  type: ConversationType;
  members: ConversationMember[];
  lastMessagePreview?: {
    messageId: UUID;
    senderUserId: UUID;
    preview: string | null;
    sentAt: Timestamp;
  };
  unreadCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MessageEnvelope {
  ciphertext: string;
  nonce: string;
  algorithm: "aes-256-gcm";
  keyVersion: number;
  aad?: Record<string, unknown>;
  clientMessageSeq: number;
}

export type WrappedKeyEntry = {
  deviceId: UUID;
  nonce: string;
  ciphertext: string;
};

export type E2eeSetupAad = {
  e2eeSetup: "g-lite-v1" | "g-lite-v2";
  senderEphemeralPublicKey: string;
  senderDeviceId: UUID;
  // v2 fan-out: conversation key K wrapped to each recipient/self device prekey.
  // Absent on legacy v1 (direct-ECDH derivation).
  wrappedKeys?: WrappedKeyEntry[];
};

export interface Message {
  messageId: UUID;
  conversationId: UUID;
  senderUserId: UUID;
  senderUsername: string;
  senderDisplayName: string;
  senderAvatarUrl?: string;
  envelope: MessageEnvelope;
  plaintext?: string;
  outboundStatus?: OutboundStatus;
  clientTempId?: UUID;
  deliveredTo: UUID[];
  readBy: UUID[];
  createdAt: Timestamp;
}

export const ReceiptStatus = {
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  READ: "READ",
} as const;
export type ReceiptStatus = typeof ReceiptStatus[keyof typeof ReceiptStatus];

export interface Receipt {
  messageId: UUID;
  userId: UUID;
  status: ReceiptStatus;
  updatedAt: Timestamp;
}

export const PresenceStatus = {
  ONLINE: "online",
  OFFLINE: "offline",
  AWAY: "away",
} as const;
export type PresenceStatus = typeof PresenceStatus[keyof typeof PresenceStatus];

export interface Presence {
  userId: UUID;
  status: PresenceStatus;
  lastSeenAt?: Timestamp;
}

export const CallType = {
  VOICE: "voice",
  VIDEO: "video",
} as const;
export type CallType = typeof CallType[keyof typeof CallType];

export const CallStatus = {
  INCOMING: "incoming",
  OUTGOING: "outgoing",
  RINGING: "ringing",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  ENDED: "ended",
  MISSED: "missed",
} as const;
export type CallStatus = typeof CallStatus[keyof typeof CallStatus];

export interface CallState {
  callId: UUID;
  conversationId: UUID;
  callType: CallType;
  status: CallStatus;
  initiatorUserId: UUID;
  recipientUserId: UUID;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  remoteSdpOffer?: string;
  remoteSdpAnswer?: string;
}

export interface IncomingCallEvent {
  callId: UUID;
  conversationId: UUID;
  callerUserId: UUID;
  callType: CallType;
  expiresAt: Timestamp;
}

export type CallLogStatus = "missed" | "rejected" | "completed" | "ended";

export interface CallLog {
  callId: UUID;
  conversationId: UUID;
  callerId: UUID;
  receiverId: UUID;
  callType: CallType;
  status: CallLogStatus;
  startedAt: Timestamp | null;
  endedAt: Timestamp | null;
  durationSec: number | null;
  createdAt: Timestamp;
}

export type TimelineItem =
  | { type: "message"; message: Message; sortAt: string }
  | { type: "call"; call: CallLog; sortAt: string };

export interface SocketEventEnvelope<T> {
  requestId: UUID;
  timestamp: Timestamp;
  payload: T;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    requestId: UUID;
  };
  meta?: Record<string, unknown>;
}

export interface OTPRequestResponse {
  otpRequestId: UUID;
  expiresInSec: number;
  cooldownSec: number;
}

export interface OTPVerifyRequest {
  otpRequestId: UUID;
  otpCode: string;
}

export interface UserSearchResult {
  userId: UUID;
  username: string;
  displayName: string;
  avatarUrl?: string;
}
