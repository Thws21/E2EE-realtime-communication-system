import { Router } from "express";
import { pool } from "../db.js";
import { fail, ok } from "../http.js";
import { authRequired } from "../middlewares/auth.js";
import { isIsoDate, isUuid, parseLimit } from "../validation.js";

const router = Router();

async function isConversationMember(conversationId: string, userId: string) {
  const result = await pool.query(
    `
      SELECT 1
      FROM conversation_members
      WHERE conversation_id = $1 AND user_id = $2
    `,
    [conversationId, userId],
  );
  return Boolean(result.rows[0]);
}

router.get("/conversations/:conversationId/messages", authRequired, async (req, res) => {
  const { conversationId } = req.params;
  const limit = parseLimit(req.query.limit);
  const beforeMessageId = req.query.beforeMessageId;
  const afterMessageId = req.query.afterMessageId;

  if (
    !isUuid(conversationId) ||
    limit === null ||
    (beforeMessageId !== undefined && !isUuid(beforeMessageId)) ||
    (afterMessageId !== undefined && !isUuid(afterMessageId)) ||
    (beforeMessageId !== undefined && afterMessageId !== undefined)
  ) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid message pagination");
  }

  if (!(await isConversationMember(conversationId, req.auth!.userId))) {
    return fail(res, 403, "PERMISSION_DENIED", "Conversation access denied");
  }

  const direction = afterMessageId ? "ASC" : "DESC";
  const cursorId = afterMessageId ?? beforeMessageId ?? null;
  const comparator = afterMessageId ? ">" : "<";
  const result = await pool.query<{
    id: string;
    conversation_id: string;
    sender_user_id: string;
    ciphertext: string;
    nonce: string;
    algorithm: string;
    key_version: number;
    aad: Record<string, unknown> | null;
    client_message_seq: number | null;
    created_at: Date;
    sender_username: string;
    sender_display_name: string;
    sender_avatar_url: string | null;
    delivered_user_ids: string[] | null;
    read_user_ids: string[] | null;
  }>(
    `
      SELECT
        m.id,
        m.conversation_id,
        m.sender_user_id,
        m.ciphertext,
        m.nonce,
        m.algorithm,
        m.key_version,
        m.aad,
        m.client_message_seq,
        m.created_at,
        u.username AS sender_username,
        u.display_name AS sender_display_name,
        u.avatar_url AS sender_avatar_url,
        rd.delivered_user_ids,
        rr.read_user_ids
      FROM messages m
      JOIN users u ON u.id = m.sender_user_id
      LEFT JOIN LATERAL (
        SELECT array_agg(user_id) AS delivered_user_ids
        FROM message_receipts
        WHERE message_id = m.id AND status = 'delivered'
      ) rd ON TRUE
      LEFT JOIN LATERAL (
        SELECT array_agg(user_id) AS read_user_ids
        FROM message_receipts
        WHERE message_id = m.id AND status = 'read'
      ) rr ON TRUE
      WHERE m.conversation_id = $1
        AND (
          $2::uuid IS NULL
          OR (m.created_at, m.id) ${comparator} (
            SELECT created_at, id
            FROM messages
            WHERE id = $2 AND conversation_id = $1
          )
        )
      ORDER BY m.created_at ${direction}, m.id ${direction}
      LIMIT $3
    `,
    [conversationId, cursorId, limit + 1],
  );

  const hasMore = result.rows.length > limit;
  let rows = result.rows.slice(0, limit);
  if (!afterMessageId) {
    rows = rows.reverse();
  }

  return ok(res, {
    messages: rows.map((row) => ({
      messageId: row.id,
      conversationId: row.conversation_id,
      senderUserId: row.sender_user_id,
      senderUsername: row.sender_username,
      senderDisplayName: row.sender_display_name,
      senderAvatarUrl: row.sender_avatar_url ?? null,
      envelope: {
        ciphertext: row.ciphertext,
        nonce: row.nonce,
        algorithm: row.algorithm,
        keyVersion: row.key_version,
        ...(row.aad ? { aad: row.aad } : {}),
        clientMessageSeq: row.client_message_seq ?? 0,
      },
      deliveredTo: row.delivered_user_ids ?? [],
      readBy: row.read_user_ids ?? [],
      createdAt: row.created_at.toISOString(),
    })),
    nextCursor: hasMore ? rows[0]?.id ?? null : null,
  });
});

router.post("/messages/:messageId/delivered", authRequired, async (req, res) => {
  const { messageId } = req.params;
  const deliveredAt = req.body?.deliveredAt;

  if (!isUuid(messageId) || !isIsoDate(deliveredAt)) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid delivered receipt");
  }

  const result = await pool.query<{ conversation_id: string }>(
    `
      SELECT m.conversation_id
      FROM messages m
      JOIN conversation_members cm
        ON cm.conversation_id = m.conversation_id
       AND cm.user_id = $2
      WHERE m.id = $1
    `,
    [messageId, req.auth!.userId],
  );
  const message = result.rows[0];

  if (!message) {
    return fail(res, 404, "CONVERSATION_NOT_FOUND", "Message or conversation not found");
  }

  await pool.query(
    `
      INSERT INTO message_receipts (
        message_id,
        conversation_id,
        user_id,
        status,
        occurred_at
      )
      VALUES ($1, $2, $3, 'delivered', $4)
      ON CONFLICT (message_id, user_id, status)
      DO UPDATE SET occurred_at = GREATEST(message_receipts.occurred_at, EXCLUDED.occurred_at)
    `,
    [messageId, message.conversation_id, req.auth!.userId, deliveredAt],
  );

  return ok(res, { updated: true });
});

router.post("/conversations/:conversationId/read", authRequired, async (req, res) => {
  const { conversationId } = req.params;
  const lastReadMessageId = req.body?.lastReadMessageId;
  const readAt = req.body?.readAt;

  if (!isUuid(conversationId) || !isUuid(lastReadMessageId) || !isIsoDate(readAt)) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid read receipt");
  }

  if (!(await isConversationMember(conversationId, req.auth!.userId))) {
    return fail(res, 403, "PERMISSION_DENIED", "Conversation access denied");
  }

  const targetResult = await pool.query(
    "SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2",
    [lastReadMessageId, conversationId],
  );
  if (!targetResult.rows[0]) {
    return fail(res, 404, "CONVERSATION_NOT_FOUND", "Message not found in conversation");
  }

  const result = await pool.query(
    `
      INSERT INTO message_receipts (
        message_id,
        conversation_id,
        user_id,
        status,
        occurred_at
      )
      SELECT id, conversation_id, $3, 'read', $4
      FROM messages
      WHERE conversation_id = $1
        AND (created_at, id) <= (
          SELECT created_at, id
          FROM messages
          WHERE id = $2 AND conversation_id = $1
        )
      ON CONFLICT (message_id, user_id, status)
      DO UPDATE SET occurred_at = GREATEST(message_receipts.occurred_at, EXCLUDED.occurred_at)
    `,
    [conversationId, lastReadMessageId, req.auth!.userId, readAt],
  );

  return ok(res, {
    lastReadMessageId,
    updatedCount: result.rowCount ?? 0,
  });
});

export const messagesRouter = router;
