import { config } from "../config.js";

export async function notifyRealtimeConversationCreated(payload: {
  conversationId: string;
  peerUserId: string;
  initiatorUserId: string;
  initiatorDisplayName?: string;
}): Promise<void> {
  const baseUrl = config.realtimeInternalBaseUrl.replace(/\/$/, "");
  try {
    const response = await fetch(`${baseUrl}/internal/conversations/notify-created`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiInternalToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.warn(
        `[api] conversation notify failed: HTTP ${response.status} conv=${payload.conversationId}`,
      );
    }
  } catch (error) {
    console.warn("[api] conversation notify error:", error);
  }
}
