import { Router } from "express";
import { pool } from "../db.js";
import { fail, ok } from "../http.js";
import { authRequired } from "../middlewares/auth.js";

const router = Router();

function isBase64Spki(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;
}

router.put("/me/ecdh-public-key", authRequired, async (req, res) => {
  const publicKey = req.body?.publicKey;
  if (!isBase64Spki(publicKey)) {
    return fail(res, 400, "VALIDATION_FAILED", "Invalid publicKey (base64 SPKI required)");
  }

  const { userId, deviceId } = req.auth!;

  try {
    await pool.query(
      `
        INSERT INTO device_ecdh_public_keys (user_id, device_id, public_key_spki, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_id, device_id)
        DO UPDATE SET public_key_spki = EXCLUDED.public_key_spki, updated_at = NOW()
      `,
      [userId, deviceId, publicKey],
    );

    return ok(res, { userId, deviceId, updatedAt: new Date().toISOString() });
  } catch {
    return fail(res, 500, "INTERNAL_ERROR", "Could not store device public key");
  }
});

export const devicesRouter = router;
