import { Router } from "express";
import { pool } from "../db.js";
import { fail, ok } from "../http.js";
import { authRequired } from "../middlewares/auth.js";
import { notifyRealtimeConversationCreated } from "../services/realtimeNotify.js";
import { isUuid, parseLimit } from "../validation.js";

const router = Router();

type MemberRow = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
};

function mapMember(row: MemberRow) {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

router.post("/direct", authRequired, async (req, res) => {
  const peerUserId = req.body?.peerUserId;
  const userId = req.auth!.userId;

  if (!isUuid(peerUserId) || peerUserId === userId) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid peerUserId");
  }

  const peerResult = await pool.query("SELECT 1 FROM users WHERE id = $1", [peerUserId]);
  if (!peerResult.rows[0]) {
    return fail(res, 404, "USER_NOT_FOUND", "User not found");
  }

  const pairKey = [userId, peerUserId].sort().join(":");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const conversationResult = await client.query<{
      id: string;
      type: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `
        INSERT INTO conversations (type, direct_pair_key)
        VALUES ('DIRECT', $1)
        ON CONFLICT (direct_pair_key) WHERE direct_pair_key IS NOT NULL
        DO UPDATE SET direct_pair_key = EXCLUDED.direct_pair_key
        RETURNING id, type, created_at, updated_at
      `,
      [pairKey],
    );

    const conversation = conversationResult.rows[0];
    await client.query(
      `
        INSERT INTO conversation_members (conversation_id, user_id)
        VALUES ($1, $2), ($1, $3)
        ON CONFLICT (conversation_id, user_id) DO NOTHING
      `,
      [conversation.id, userId, peerUserId],
    );

    const membersResult = await client.query<MemberRow & { joined_at: Date }>(
      `
        SELECT u.id AS user_id, u.username, u.display_name, u.avatar_url,
               cm.joined_at
        FROM conversation_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.conversation_id = $1
        ORDER BY u.id
      `,
      [conversation.id],
    );
    await client.query("COMMIT");

    const initiatorMember = membersResult.rows.find((row) => row.user_id === userId);
    void notifyRealtimeConversationCreated({
      conversationId: conversation.id,
      peerUserId,
      initiatorUserId: userId,
      initiatorDisplayName: initiatorMember?.display_name,
    });

    return ok(res, {
      conversationId: conversation.id,
      type: conversation.type,
      members: membersResult.rows.map((row) => ({
        ...mapMember(row),
        joinedAt: row.joined_at.toISOString(),
      })),
      unreadCount: 0,
      createdAt: conversation.created_at.toISOString(),
      updatedAt: conversation.updated_at.toISOString(),
    });
  } catch {
    await client.query("ROLLBACK");
    return fail(res, 500, "INTERNAL_ERROR", "Could not create conversation");
  } finally {
    client.release();
  }
});

router.get("/", authRequired, async (req, res) => {
  const limit = parseLimit(req.query.limit);
  const cursor = req.query.cursor;

  if (limit === null || (cursor !== undefined && !isUuid(cursor))) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid pagination");
  }

  const result = await pool.query<{
    conversation_id: string;
    type: string;
    created_at: Date;
    updated_at: Date;
    message_id: string | null;
    sender_user_id: string | null;
    ciphertext: string | null;
    message_created_at: Date | null;
    unread_count: string;
    members: Array<{
      userId: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
      joinedAt: string;
    }>;
  }>(
    `
      WITH cursor_row AS (
        SELECT updated_at, id
        FROM conversations
        WHERE id = $3
      )
      SELECT
        c.id AS conversation_id,
        c.type,
        c.created_at,
        c.updated_at,
        lm.id AS message_id,
        lm.sender_user_id,
        lm.ciphertext,
        lm.created_at AS message_created_at,
        (
          SELECT COUNT(*)
          FROM messages unread_message
          WHERE unread_message.conversation_id = c.id
            AND unread_message.sender_user_id <> $1
            AND NOT EXISTS (
              SELECT 1
              FROM message_receipts receipt
              WHERE receipt.message_id = unread_message.id
                AND receipt.user_id = $1
                AND receipt.status = 'read'
            )
        )::text AS unread_count,
        ARRAY(
          SELECT json_build_object(
            'userId', u.id,
            'username', u.username,
            'displayName', u.display_name,
            'avatarUrl', u.avatar_url,
            'joinedAt', cm.joined_at
          )
          FROM conversation_members cm
          JOIN users u ON u.id = cm.user_id
          WHERE cm.conversation_id = c.id
        ) AS members
      FROM conversations c
      JOIN conversation_members own_membership
        ON own_membership.conversation_id = c.id
       AND own_membership.user_id = $1
      LEFT JOIN LATERAL (
        SELECT id, sender_user_id, ciphertext, created_at
        FROM messages
        WHERE conversation_id = c.id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) lm ON TRUE
      WHERE (
        $3::uuid IS NULL
        OR (c.updated_at, c.id) < (
          SELECT updated_at, id FROM cursor_row
        )
      )
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT $2
    `,
    [req.auth!.userId, limit + 1, cursor ?? null],
  );

  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const conversations = rows.map((row) => ({
    conversationId: row.conversation_id,
    type: row.type,
    members: row.members ?? [],
    ...(row.message_id
      ? {
          lastMessagePreview: {
            messageId: row.message_id,
            senderUserId: row.sender_user_id,
            // E2EE: server cannot decrypt; no ciphertext in preview.
            preview: null,
            sentAt: row.message_created_at?.toISOString(),
          },
        }
      : {}),
    unreadCount: Number(row.unread_count),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));

  return ok(res, {
    conversations,
    nextCursor: hasMore ? rows.at(-1)?.conversation_id ?? null : null,
  });
});

export const conversationsRouter = router;
