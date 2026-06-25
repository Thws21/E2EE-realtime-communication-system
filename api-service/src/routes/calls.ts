import { Router } from "express";
import { pool } from "../db.js";
import { fail, ok } from "../http.js";
import { authRequired } from "../middlewares/auth.js";
import { isUuid, parseLimit } from "../validation.js";

const router = Router({ mergeParams: true });

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

router.get("/", authRequired, async (req, res) => {
  const conversationId = req.params.conversationId;
  const limit = parseLimit(req.query.limit);
  const beforeCallId = req.query.beforeCallId;

  if (
    !isUuid(conversationId) ||
    limit === null ||
    (beforeCallId !== undefined && !isUuid(beforeCallId))
  ) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid call pagination");
  }

  if (!(await isConversationMember(conversationId, req.auth!.userId))) {
    return fail(res, 403, "PERMISSION_DENIED", "Conversation access denied");
  }

  const result = await pool.query<{
    id: string;
    conversation_id: string;
    caller_id: string;
    receiver_id: string;
    call_type: string;
    status: string;
    started_at: Date | null;
    ended_at: Date | null;
    created_at: Date;
  }>(
    `
      SELECT
        id,
        conversation_id,
        caller_id,
        receiver_id,
        call_type,
        status,
        started_at,
        ended_at,
        created_at
      FROM call_logs
      WHERE conversation_id = $1
        AND (
          $2::uuid IS NULL
          OR (created_at, id) < (
            SELECT created_at, id
            FROM call_logs
            WHERE id = $2 AND conversation_id = $1
          )
        )
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    `,
    [conversationId, beforeCallId ?? null, limit + 1],
  );

  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit).reverse();

  return ok(res, {
    calls: rows.map((row) => {
      const startedMs = row.started_at ? row.started_at.getTime() : null;
      const endedMs = row.ended_at ? row.ended_at.getTime() : null;
      const durationSec =
        startedMs !== null && endedMs !== null && endedMs >= startedMs
          ? Math.round((endedMs - startedMs) / 1000)
          : null;

      return {
        callId: row.id,
        conversationId: row.conversation_id,
        callerId: row.caller_id,
        receiverId: row.receiver_id,
        callType: row.call_type,
        status: row.status,
        startedAt: row.started_at?.toISOString() ?? null,
        endedAt: row.ended_at?.toISOString() ?? null,
        durationSec,
        createdAt: row.created_at.toISOString(),
      };
    }),
    nextCursor: hasMore ? result.rows[limit]?.id ?? null : null,
  });
});

export const callsRouter = router;
