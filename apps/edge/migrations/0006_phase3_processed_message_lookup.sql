CREATE INDEX IF NOT EXISTS idx_processed_command_messages_match_expires_at
  ON processed_command_messages(match_id, expires_at);
