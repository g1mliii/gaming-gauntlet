CREATE INDEX IF NOT EXISTS idx_audit_log_channel_link_created_at
  ON audit_log(channel_link_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_user_created_at
  ON audit_log(actor_user_id, created_at DESC);
