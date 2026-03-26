ALTER TABLE matches ADD COLUMN board_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN chat_enabled_until TEXT;

ALTER TABLE suggestions ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE suggestions ADD COLUMN vote_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS channel_chat_targets (
  source_twitch_channel_id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  channel_link_id TEXT NOT NULL,
  state TEXT NOT NULL,
  enabled_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (channel_link_id) REFERENCES channel_links(id)
);

CREATE TABLE IF NOT EXISTS eventsub_subscriptions (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL UNIQUE,
  channel_link_id TEXT NOT NULL,
  source_twitch_channel_id TEXT NOT NULL,
  broadcaster_twitch_channel_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  last_verified_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_link_id) REFERENCES channel_links(id)
);

CREATE TABLE IF NOT EXISTS processed_command_messages (
  message_id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  source_twitch_channel_id TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestions_match_canonical_key
  ON suggestions(match_id, canonical_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestions_match_board_id
  ON suggestions(match_id, board_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_match_voter
  ON votes(match_id, voter_twitch_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_chat_targets_match_id
  ON channel_chat_targets(match_id, source_twitch_channel_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eventsub_subscriptions_source_type
  ON eventsub_subscriptions(source_twitch_channel_id, type);

CREATE INDEX IF NOT EXISTS idx_matches_status_updated_at
  ON matches(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_processed_command_messages_expires_at
  ON processed_command_messages(expires_at);
