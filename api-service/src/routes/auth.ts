import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  issueAccessToken,
  normalizeDeviceInfo,
  readDeviceIdFromSessionInfo,
  resolveDeviceId,
} from "../accessToken.js";
import { createUuidV7 } from "../ids.js";
import { config } from "../config.js";
import { pool } from "../db.js";
import { fail, ok } from "../http.js";
import { sendRegistrationOtp } from "../mailer.js";
import { authRequired } from "../middlewares/auth.js";
import {
  hashSecret,
  randomOtpCode,
  randomToken,
  sha256,
  verifySecret,
} from "../security.js";

const router = Router();

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[a-zA-Z0-9_]{3,50}$/;

function normalizeEmail(email: unknown) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function normalizeUsername(username: unknown) {
  return typeof username === "string" ? username.trim().toLowerCase() : "";
}

async function createSessionAndRefreshToken(
  userId: string,
  deviceInfo: Record<string, unknown> = {},
) {
  const normalizedDeviceInfo = normalizeDeviceInfo(deviceInfo);
  const deviceId = resolveDeviceId(normalizedDeviceInfo);

  const sessionResult = await pool.query<{ id: string }>(
    "INSERT INTO sessions (user_id, device_info) VALUES ($1, $2) RETURNING id",
    [userId, normalizedDeviceInfo],
  );
  const sessionId = sessionResult.rows[0].id;
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlSec * 1000);

  const tokenResult = await pool.query<{ id: string }>(
    `
      INSERT INTO refresh_tokens (user_id, session_id, token_hash, expires_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [userId, sessionId, sha256(refreshToken), expiresAt],
  );

  return {
    sessionId,
    deviceId,
    refreshToken,
    refreshTokenId: tokenResult.rows[0].id,
  };
}

router.post("/register/request-otp", async (req, res) => {
  const requestId = randomUUID();
  const email = normalizeEmail(req.body?.email);
  const username = normalizeUsername(req.body?.username);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";

  if (!emailPattern.test(email) || !usernamePattern.test(username) || password.length < 8 || !displayName) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid registration data", requestId);
  }

  try {
    const otpCode = randomOtpCode();
    const result = await pool.query<{ id: string }>(
      `
        INSERT INTO otp_requests (
          email,
          username,
          password_hash,
          display_name,
          otp_code_hash,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '10 minutes')
        RETURNING id
      `,
      [email, username, hashSecret(password), displayName, hashSecret(otpCode)],
    );
    const otpRequestId = result.rows[0].id;

    try {
      await sendRegistrationOtp(email, otpCode);
    } catch (error) {
      await pool.query("DELETE FROM otp_requests WHERE id = $1", [otpRequestId]);
      console.error("Could not send registration OTP email", error);
      return fail(res, 503, "INTERNAL_ERROR", "Could not send OTP email", requestId);
    }

    const data: Record<string, unknown> = {
      otpRequestId,
      expiresInSec: 600,
      cooldownSec: 60,
      delivery: "email",
    };

    if (config.nodeEnv === "development") {
      data.otpCode = otpCode;
    }

    return ok(res, data);
  } catch {
    return fail(res, 500, "INTERNAL_ERROR", "Could not create OTP request", requestId);
  }
});

router.post("/register/verify-otp", async (req, res) => {
  const requestId = randomUUID();
  const otpRequestId = typeof req.body?.otpRequestId === "string" ? req.body.otpRequestId : "";
  const otpCode = typeof req.body?.otpCode === "string" ? req.body.otpCode : "";

  if (!otpRequestId || !/^\d{6}$/.test(otpCode)) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid OTP data", requestId);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const otpResult = await client.query<{
      id: string;
      email: string;
      username: string;
      password_hash: string;
      display_name: string;
      otp_code_hash: string;
      expires_at: Date;
      consumed_at: Date | null;
      attempts: number;
    }>(
      "SELECT * FROM otp_requests WHERE id = $1 FOR UPDATE",
      [otpRequestId],
    );

    const otp = otpResult.rows[0];
    if (!otp || otp.consumed_at || otp.attempts >= 5) {
      await client.query("ROLLBACK");
      return fail(res, 400, "OTP_INVALID", "Invalid OTP", requestId);
    }

    if (otp.expires_at.getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return fail(res, 400, "OTP_EXPIRED", "OTP expired", requestId);
    }

    if (!verifySecret(otpCode, otp.otp_code_hash)) {
      await client.query("UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1", [otp.id]);
      await client.query("COMMIT");
      return fail(res, 400, "OTP_INVALID", "Invalid OTP", requestId);
    }

    const userResult = await client.query<{
      id: string;
      email: string;
      username: string;
      display_name: string;
      avatar_url: string | null;
    }>(
      `
        INSERT INTO users (email, username, password_hash, display_name)
        VALUES ($1, $2, $3, $4)
        RETURNING id, email, username, display_name, avatar_url
      `,
      [otp.email, otp.username, otp.password_hash, otp.display_name],
    );

    await client.query("UPDATE otp_requests SET consumed_at = NOW() WHERE id = $1", [otp.id]);
    await client.query("COMMIT");

    const newUser = userResult.rows[0];
    const userId = newUser.id;
    const session = await createSessionAndRefreshToken(userId);

    return ok(res, {
      userId,
      user: {
        userId: newUser.id,
        email: newUser.email,
        username: newUser.username,
        displayName: newUser.display_name,
        avatarUrl: newUser.avatar_url,
      },
      accessToken: issueAccessToken(userId, session.sessionId, session.deviceId),
      refreshToken: session.refreshToken,
      expiresInSec: config.accessTokenTtlSec,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return fail(res, 400, "VALIDATION_FAILED", "Email or username is already registered", requestId);
    }
    return fail(res, 500, "INTERNAL_ERROR", "Could not verify OTP", requestId);
  } finally {
    client.release();
  }
});

router.post("/login", async (req, res) => {
  const requestId = randomUUID();
  const identifier =
    typeof req.body?.identifier === "string" ? req.body.identifier.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const deviceInfo =
    req.body?.deviceInfo && typeof req.body.deviceInfo === "object" ? req.body.deviceInfo : {};

  if (!identifier || !password) {
    return fail(res, 400, "VALIDATION_FAILED", "Missing login credentials", requestId);
  }

  const result = await pool.query<{
    id: string;
    email: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    password_hash: string;
  }>(
    `
      SELECT id, email, username, display_name, avatar_url, password_hash
      FROM users
      WHERE email = $1 OR username = $1
      LIMIT 1
    `,
    [identifier],
  );

  const user = result.rows[0];
  if (!user || !verifySecret(password, user.password_hash)) {
    return fail(res, 401, "AUTH_INVALID_CREDENTIALS", "Invalid credentials", requestId);
  }

  const session = await createSessionAndRefreshToken(user.id, deviceInfo as Record<string, unknown>);

  return ok(res, {
    user: {
      userId: user.id,
      email: user.email,
      username: user.username,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
    },
    accessToken: issueAccessToken(user.id, session.sessionId, session.deviceId),
    refreshToken: session.refreshToken,
    expiresInSec: config.accessTokenTtlSec,
  });
});

router.post("/refresh", async (req, res) => {
  const requestId = randomUUID();
  const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : "";
  if (!refreshToken) {
    return fail(res, 400, "VALIDATION_FAILED", "Missing refresh token", requestId);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tokenResult = await client.query<{
      id: string;
      user_id: string;
      session_id: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      "SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE",
      [sha256(refreshToken)],
    );

    const token = tokenResult.rows[0];
    if (!token) {
      await client.query("ROLLBACK");
      return fail(res, 401, "AUTH_REFRESH_REVOKED", "Invalid refresh token", requestId);
    }

    if (token.revoked_at) {
      await client.query("UPDATE sessions SET revoked_at = NOW() WHERE id = $1", [token.session_id]);
      await client.query("COMMIT");
      return fail(
        res,
        401,
        "AUTH_REFRESH_REPLAY_DETECTED",
        "Refresh token replay detected",
        requestId,
      );
    }

    if (token.expires_at.getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return fail(res, 401, "AUTH_TOKEN_EXPIRED", "Refresh token expired", requestId);
    }

    const sessionResult = await client.query<{ device_info: unknown }>(
      "SELECT device_info FROM sessions WHERE id = $1 LIMIT 1",
      [token.session_id],
    );
    const deviceId =
      readDeviceIdFromSessionInfo(sessionResult.rows[0]?.device_info) ?? createUuidV7();

    const newRefreshToken = randomToken();
    const expiresAt = new Date(Date.now() + config.refreshTokenTtlSec * 1000);
    const newTokenResult = await client.query<{ id: string }>(
      `
        INSERT INTO refresh_tokens (user_id, session_id, token_hash, expires_at)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [token.user_id, token.session_id, sha256(newRefreshToken), expiresAt],
    );

    await client.query(
      "UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by_token_id = $1 WHERE id = $2",
      [newTokenResult.rows[0].id, token.id],
    );
    await client.query("COMMIT");

    return ok(res, {
      accessToken: issueAccessToken(token.user_id, token.session_id, deviceId),
      refreshToken: newRefreshToken,
      refreshTokenId: newTokenResult.rows[0].id,
      expiresInSec: config.accessTokenTtlSec,
    });
  } catch {
    await client.query("ROLLBACK");
    return fail(res, 500, "INTERNAL_ERROR", "Could not refresh token", requestId);
  } finally {
    client.release();
  }
});

router.post("/logout", async (req, res) => {
  const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : "";
  if (!refreshToken) {
    return fail(res, 400, "VALIDATION_FAILED", "Missing refresh token");
  }

  const result = await pool.query(
    "UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE token_hash = $1",
    [sha256(refreshToken)],
  );

  return ok(res, { revoked: (result.rowCount ?? 0) > 0 });
});

router.post("/logout-all", authRequired, async (req, res) => {
  const result = await pool.query(
    "UPDATE sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1 AND revoked_at IS NULL",
    [req.auth!.userId],
  );

  return ok(res, { revokedSessionCount: result.rowCount ?? 0 });
});

export const authRouter = router;
