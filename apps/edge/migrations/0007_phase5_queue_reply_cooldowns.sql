CREATE TABLE IF NOT EXISTS queue_reply_cooldowns (
  key TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_queue_reply_cooldowns_expires_at
  ON queue_reply_cooldowns(expires_at);
