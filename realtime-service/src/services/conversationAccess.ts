import type { AppConfig } from "../config.js";

export type ConversationAccessService = {
  canJoinConversation(userId: string, conversationId: string): Promise<boolean>;
};

type MembershipResponse = {
  success?: boolean;
  data?: {
    member?: boolean;
    isMember?: boolean;
    allowed?: boolean;
  };
};

export function createConversationAccessService(config: AppConfig): ConversationAccessService {
  return {
    async canJoinConversation(userId, conversationId) {
      if (config.allowDevConversationAccess) {
        return true;
      }

      const baseUrl = config.apiInternalBaseUrl.replace(/\/+$/, "");

      const url = `${baseUrl}/api/v1/internal/conversations/${conversationId}/members/${userId}`;

      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${config.apiInternalToken}`,
          },
        });

        const text = await response.text();

        if (!response.ok) {
          return false;
        }

        const body = JSON.parse(text) as MembershipResponse;

        return (
          body.data?.member === true ||
          body.data?.isMember === true ||
          body.data?.allowed === true
        );
      } catch (err) {
        console.error(
          `conversationAccess: membership check failed userId=${userId} conversationId=${conversationId}`,
          err,
        );

        return false;
      }
    },
  };
}
