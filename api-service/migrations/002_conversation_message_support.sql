ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS direct_pair_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_direct_pair_key
  ON conversations (direct_pair_key)
  WHERE direct_pair_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_id
  ON messages (conversation_id, id);

CREATE INDEX IF NOT EXISTS idx_message_receipts_user_status_message
  ON message_receipts (user_id, status, message_id);
