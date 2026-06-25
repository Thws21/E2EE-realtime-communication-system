import type {
  AuthResponse,
  UUID,
  OTPRequestResponse,
  OTPVerifyRequest,
  ApiResponse,
  DeviceInfo,
  Conversation,
  UserSearchResult,
  CallLog,
} from "../types/index.js";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "/api/v1";

export class ApiError extends Error {
  statusCode: number;
  errorCode: string;
  requestId?: string;

  constructor(
    statusCode: number,
    errorCode: string,
    requestId?: string,
    errorMessage?: string,
  ) {
    super(errorMessage || `API Error: ${errorCode}`);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.requestId = requestId;
  }
}

export class ApiClient {
  private accessToken: string | null = null;
  private refreshHandler: (() => Promise<string>) | null = null;
  private refreshPromise: Promise<string> | null = null;

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  setRefreshHandler(fn: (() => Promise<string>) | null) {
    this.refreshHandler = fn;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    skipRefresh = false,
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    } as Record<string, string>;

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 && this.refreshHandler && !skipRefresh) {
      // Coalesce parallel 401s into one refresh.
      if (!this.refreshPromise) {
        this.refreshPromise = this.refreshHandler().finally(() => {
          this.refreshPromise = null;
        });
      }
      const newToken = await this.refreshPromise;
      this.accessToken = newToken;
      const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` };
      const retryResponse = await fetch(url, { ...options, headers: retryHeaders });
      if (!retryResponse.headers.get("content-type")?.includes("application/json")) {
        throw new ApiError(retryResponse.status, "UNKNOWN_ERROR", undefined, `HTTP ${retryResponse.status}`);
      }
      const retryData = (await retryResponse.json()) as ApiResponse<T>;
      if (!retryResponse.ok || !retryData.success) {
        throw new ApiError(
          retryResponse.status,
          retryData.error?.code || "UNKNOWN_ERROR",
          retryData.error?.requestId,
          retryData.error?.message,
        );
      }
      return retryData.data as T;
    }

    // Reject non-JSON bodies (e.g. nginx HTML 404).
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new ApiError(response.status, "UNKNOWN_ERROR", undefined, `HTTP ${response.status}`);
    }
    const data = (await response.json()) as ApiResponse<T>;

    if (!response.ok || !data.success) {
      throw new ApiError(
        response.status,
        data.error?.code || "UNKNOWN_ERROR",
        data.error?.requestId,
        data.error?.message,
      );
    }

    return data.data as T;
  }

  async requestOtp(
    email: string,
    username: string,
    password: string,
    displayName: string,
  ): Promise<OTPRequestResponse> {
    return this.request<OTPRequestResponse>("/auth/register/request-otp", {
      method: "POST",
      body: JSON.stringify({
        email,
        username,
        password,
        displayName,
      }),
    });
  }

  async verifyOtp(req: OTPVerifyRequest): Promise<AuthResponse> {
    return this.request<AuthResponse>("/auth/register/verify-otp", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async login(
    identifier: string,
    password: string,
    deviceInfo: DeviceInfo,
  ): Promise<AuthResponse> {
    return this.request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        identifier,
        password,
        deviceInfo,
      }),
    });
  }

  async refreshToken(refreshToken: string): Promise<AuthResponse> {
    // skipRefresh: avoid deadlock when /auth/refresh returns 401.
    return this.request<AuthResponse>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }, true);
  }

  async logout(refreshToken: string): Promise<{ revoked: boolean }> {
    return this.request<{ revoked: boolean }>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  }

  async logoutAll(): Promise<{ revokedSessionCount: number }> {
    return this.request<{ revokedSessionCount: number }>(
      "/auth/logout-all",
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
  }

  async searchUsers(
    query: string,
    limit: number = 20,
    cursor?: string,
  ): Promise<{
    results: UserSearchResult[];
    nextCursor?: string;
  }> {
    const params = new URLSearchParams({
      q: query,
      limit: limit.toString(),
      ...(cursor && { cursor }),
    });

    return this.request<{
      results: UserSearchResult[];
      nextCursor?: string;
    }>(`/users/search?${params.toString()}`);
  }

  async getOrCreateDirectConversation(
    peerUserId: UUID,
  ): Promise<Conversation> {
    return this.request<Conversation>("/conversations/direct", {
      method: "POST",
      body: JSON.stringify({ peerUserId }),
    });
  }

  async getConversations(
    limit: number = 50,
    cursor?: string,
  ): Promise<{
    conversations: Conversation[];
    nextCursor?: string;
  }> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      ...(cursor && { cursor }),
    });

    return this.request<{
      conversations: Conversation[];
      nextCursor?: string;
    }>(`/conversations?${params.toString()}`);
  }

  async getConversation(conversationId: UUID): Promise<Conversation> {
    return this.request<Conversation>(
      `/conversations/${conversationId}`,
    );
  }

  async getMessages(
    conversationId: UUID,
    limit: number = 50,
    beforeMessageId?: string,
  ): Promise<{
    messages: Message[];
    nextCursor?: string;
  }> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      ...(beforeMessageId && { beforeMessageId }),
    });

    return this.request<{
      messages: Message[];
      nextCursor?: string;
    }>(`/conversations/${conversationId}/messages?${params.toString()}`);
  }

  async getCalls(
    conversationId: UUID,
    limit: number = 50,
    beforeCallId?: string,
  ): Promise<{
    calls: CallLog[];
    nextCursor?: string;
  }> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      ...(beforeCallId && { beforeCallId }),
    });

    return this.request<{
      calls: CallLog[];
      nextCursor?: string;
    }>(`/conversations/${conversationId}/calls?${params.toString()}`);
  }

  async markMessageDelivered(messageId: UUID, deliveredAt: string): Promise<{ updated: boolean }> {
    return this.request<{ updated: boolean }>(`/messages/${messageId}/delivered`, {
      method: "POST",
      body: JSON.stringify({ deliveredAt }),
    });
  }

  async markConversationRead(
    conversationId: UUID,
    lastReadMessageId: UUID,
    readAt: string,
  ): Promise<{ lastReadMessageId: UUID; updatedCount: number }> {
    return this.request<{ lastReadMessageId: UUID; updatedCount: number }>(
      `/conversations/${conversationId}/read`,
      {
        method: "POST",
        body: JSON.stringify({ lastReadMessageId, readAt }),
      },
    );
  }

  async putDeviceEcdhPublicKey(publicKey: string): Promise<{ userId: UUID; deviceId: UUID }> {
    return this.request<{ userId: UUID; deviceId: UUID }>("/devices/me/ecdh-public-key", {
      method: "PUT",
      body: JSON.stringify({ publicKey }),
    });
  }

  async getUserEcdhPublicKey(userId: UUID): Promise<{
    userId: UUID;
    deviceId: UUID;
    publicKey: string;
    updatedAt: string;
  }> {
    return this.request<{
      userId: UUID;
      deviceId: UUID;
      publicKey: string;
      updatedAt: string;
    }>(`/users/${userId}/ecdh-public-key`);
  }

  async getUserEcdhPublicKeys(
    userId: UUID,
  ): Promise<{ deviceId: UUID; publicKey: string; updatedAt: string }[]> {
    try {
      const res = await this.request<{
        userId: UUID;
        keys: { deviceId: UUID; publicKey: string; updatedAt: string }[];
      }>(`/users/${userId}/ecdh-public-keys`);
      return res.keys;
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 404) {
        return [];
      }
      throw err;
    }
  }
}

export const apiClient = new ApiClient();

import type { Message } from "../types/index.js";
