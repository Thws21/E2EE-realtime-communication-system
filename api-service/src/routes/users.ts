import { Router } from "express";
import { pool } from "../db.js";
import { fail, ok } from "../http.js";
import { authRequired } from "../middlewares/auth.js";
import { isUuid, parseLimit } from "../validation.js";

const router = Router();

router.get("/search", authRequired, async (req, res) => {
  const q = req.query.q;
  const limit = parseLimit(req.query.limit, 20, 50);
  const cursor = req.query.cursor;

  if (typeof q !== "string" || q.trim().length < 1 || q.length > 100 || limit === null) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid search query");
  }
  if (cursor !== undefined && !isUuid(cursor)) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid cursor");
  }

  // Strip leading @ for username prefix search.
  const trimmedQuery = q.trim();
  const usernameQuery = trimmedQuery.startsWith("@") ? trimmedQuery.slice(1) : trimmedQuery;

  const result = await pool.query<{
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  }>(
    `
      SELECT id, username, display_name, avatar_url
      FROM users
      WHERE id <> $1
        AND (
          username ILIKE $2 || '%'
          OR lower(email) = lower($3)
        )
        AND ($4::uuid IS NULL OR id > $4)
      ORDER BY username ASC
      LIMIT $5
    `,
    [req.auth!.userId, usernameQuery, trimmedQuery, cursor ?? null, limit + 1],
  );

  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);

  return ok(res, {
    results: rows.map((row) => ({
      userId: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null,
    })),
    nextCursor: hasMore ? rows.at(-1)?.id ?? null : null,
  });
});

router.get("/:userId/ecdh-public-key", authRequired, async (req, res) => {
  const { userId } = req.params;
  if (!isUuid(userId)) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid userId");
  }

  const userExists = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE id = $1",
    [userId],
  );
  if (userExists.rowCount === 0) {
    return fail(res, 404, "USER_NOT_FOUND", "User not found");
  }

  const result = await pool.query<{
    user_id: string;
    device_id: string;
    public_key_spki: string;
    updated_at: Date;
  }>(
    `
      SELECT user_id, device_id, public_key_spki, updated_at
      FROM device_ecdh_public_keys
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [userId],
  );

  const row = result.rows[0];
  if (!row) {
    return fail(
      res,
      404,
      "DEVICE_PREKEY_NOT_FOUND",
      "User has no device public key registered",
    );
  }

  return ok(res, {
    userId: row.user_id,
    deviceId: row.device_id,
    publicKey: row.public_key_spki,
    updatedAt: row.updated_at.toISOString(),
  });
});

// Plural: all device prekeys for a user (multi-device fan-out). Deduped by public key.
router.get("/:userId/ecdh-public-keys", authRequired, async (req, res) => {
  const { userId } = req.params;
  if (!isUuid(userId)) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid userId");
  }

  const userExists = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE id = $1",
    [userId],
  );
  if (userExists.rowCount === 0) {
    return fail(res, 404, "USER_NOT_FOUND", "User not found");
  }

  const result = await pool.query<{
    device_id: string;
    public_key_spki: string;
    updated_at: Date;
  }>(
    `
      SELECT device_id, public_key_spki, updated_at
      FROM device_ecdh_public_keys
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT 20
    `,
    [userId],
  );

  const seen = new Set<string>();
  const keys = [];
  for (const row of result.rows) {
    if (seen.has(row.public_key_spki)) continue;
    seen.add(row.public_key_spki);
    keys.push({
      deviceId: row.device_id,
      publicKey: row.public_key_spki,
      updatedAt: row.updated_at.toISOString(),
    });
  }

  return ok(res, { userId, keys });
});

export const usersRouter = router;
