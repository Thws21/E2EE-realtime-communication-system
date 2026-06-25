import { Router } from "express";
import { pool } from "../db.js";
import { fail, ok } from "../http.js";
import { internalAuthRequired } from "../middlewares/internalAuth.js";
import { isUuid } from "../validation.js";

const router = Router();

router.post("/messages/persist", internalAuthRequired, async (req, res) => {
  const { requestId, messageId, conversationId, senderUserId, senderDeviceId, envelope } =
    req.body ?? {};

  if (
    !isUuid(requestId) ||
    !isUuid(messageId) ||
    !isUuid(conversationId) ||
    !isUuid(senderUserId) ||
    !isUuid(senderDeviceId) ||
    !envelope ||
    typeof envelope !== "object" ||
    typeof envelope.ciphertext !== "string" ||
    typeof envelope.nonce !== "string" ||
    envelope.algorithm !== "aes-256-gcm" ||
    !Number.isInteger(envelope.keyVersion) ||
    envelope.keyVersion < 1 ||
    !Number.isInteger(envelope.clientMessageSeq) ||
    envelope.clientMessageSeq < 0
  ) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid encrypted message envelope");
  }

  const membershipResult = await pool.query(
    `
      SELECT 1
      FROM conversation_members
      WHERE conversation_id = $1 AND user_id = $2
    `,
    [conversationId, senderUserId],
  );
  if (!membershipResult.rows[0]) {
    return fail(res, 403, "PERMISSION_DENIED", "Sender is not a conversation member");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingResult = await client.query<{ id: string; created_at: Date }>(
      `
        SELECT id, created_at
        FROM messages
        WHERE request_id = $1 AND sender_device_id = $2
        FOR UPDATE
      `,
      [requestId, senderDeviceId],
    );
    const existing = existingResult.rows[0];
    if (existing) {
      await client.query("COMMIT");
      return ok(res, {
        stored: true,
        createdAt: existing.created_at.toISOString(),
        deduped: true,
      });
    }

    const insertResult = await client.query<{ created_at: Date }>(
      `
        INSERT INTO messages (
          id,
          request_id,
          conversation_id,
          sender_user_id,
          sender_device_id,
          ciphertext,
          nonce,
          algorithm,
          key_version,
          aad,
          client_message_seq
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING created_at
      `,
      [
        messageId,
        requestId,
        conversationId,
        senderUserId,
        senderDeviceId,
        envelope.ciphertext,
        envelope.nonce,
        envelope.algorithm,
        envelope.keyVersion,
        envelope.aad ?? null,
        envelope.clientMessageSeq,
      ],
    );

    await client.query("UPDATE conversations SET updated_at = NOW() WHERE id = $1", [
      conversationId,
    ]);
    await client.query("COMMIT");

    return ok(res, {
      stored: true,
      createdAt: insertResult.rows[0].created_at.toISOString(),
      deduped: false,
    });
  } catch (error) {
    await client.query("ROLLBACK");

    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      const duplicateResult = await pool.query<{ created_at: Date }>(
        `
          SELECT created_at
          FROM messages
          WHERE request_id = $1 AND sender_device_id = $2
        `,
        [requestId, senderDeviceId],
      );
      const duplicate = duplicateResult.rows[0];
      if (duplicate) {
        return ok(res, {
          stored: true,
          createdAt: duplicate.created_at.toISOString(),
          deduped: true,
        });
      }
      return fail(res, 409, "VALIDATION_FAILED", "Duplicate message or nonce");
    }

    return fail(res, 500, "INTERNAL_ERROR", "Could not persist message");
  } finally {
    client.release();
  }
});

router.get(
  "/conversations/:conversationId/members/:userId",
  internalAuthRequired,
  async (req, res) => {
    const { conversationId, userId } = req.params;
    if (!isUuid(conversationId) || !isUuid(userId)) {
      return fail(res, 400, "VALIDATION_FAILED", "Invalid membership query");
    }

    const result = await pool.query(
      `
        SELECT 1
        FROM conversation_members
        WHERE conversation_id = $1 AND user_id = $2
      `,
      [conversationId, userId],
    );

    return ok(res, { member: Boolean(result.rows[0]) });
  },
);

const CALL_STATUSES = new Set(["missed", "rejected", "completed", "ended"]);
const CALL_TYPES = new Set(["voice", "video"]);

router.post("/calls/persist", internalAuthRequired, async (req, res) => {
  const { callId, conversationId, callerId, callType, status, startedAt, endedAt } =
    req.body ?? {};

  if (
    !isUuid(callId) ||
    !isUuid(conversationId) ||
    !isUuid(callerId) ||
    typeof callType !== "string" ||
    !CALL_TYPES.has(callType) ||
    typeof status !== "string" ||
    !CALL_STATUSES.has(status)
  ) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid call log payload");
  }

  if (startedAt !== undefined && typeof startedAt !== "string") {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid startedAt");
  }
  if (endedAt !== undefined && typeof endedAt !== "string") {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid endedAt");
  }

  const receiverResult = await pool.query<{ user_id: string }>(
    `
      SELECT user_id
      FROM conversation_members
      WHERE conversation_id = $1 AND user_id <> $2
      LIMIT 1
    `,
    [conversationId, callerId],
  );
  const receiver = receiverResult.rows[0];
  if (!receiver) {
    return fail(res, 403, "PERMISSION_DENIED", "Caller is not in a direct conversation");
  }

  const existingResult = await pool.query<{ id: string; created_at: Date }>(
    "SELECT id, created_at FROM call_logs WHERE id = $1",
    [callId],
  );
  if (existingResult.rows[0]) {
    return ok(res, {
      stored: true,
      createdAt: existingResult.rows[0].created_at.toISOString(),
      deduped: true,
    });
  }

  try {
    const insertResult = await pool.query<{ created_at: Date }>(
      `
        INSERT INTO call_logs (
          id,
          conversation_id,
          caller_id,
          receiver_id,
          call_type,
          status,
          started_at,
          ended_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING created_at
      `,
      [
        callId,
        conversationId,
        callerId,
        receiver.user_id,
        callType,
        status,
        startedAt ?? null,
        endedAt ?? null,
      ],
    );

    await pool.query("UPDATE conversations SET updated_at = NOW() WHERE id = $1", [
      conversationId,
    ]);

    return ok(res, {
      stored: true,
      createdAt: insertResult.rows[0].created_at.toISOString(),
      deduped: false,
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      const dup = await pool.query<{ created_at: Date }>(
        "SELECT created_at FROM call_logs WHERE id = $1",
        [callId],
      );
      if (dup.rows[0]) {
        return ok(res, {
          stored: true,
          createdAt: dup.rows[0].created_at.toISOString(),
          deduped: true,
        });
      }
    }
    return fail(res, 500, "INTERNAL_ERROR", "Could not persist call log");
  }
});

export const internalRouter = router;
