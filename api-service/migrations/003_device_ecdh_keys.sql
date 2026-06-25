CREATE TABLE IF NOT EXISTS device_ecdh_public_keys (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  public_key_spki TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_ecdh_user_updated
  ON device_ecdh_public_keys (user_id, updated_at DESC);
