CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  twitch_user_id TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  twitch_channel_id TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL,
  display_name TEXT NOT NULL,
  owner_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS twitch_tokens (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  subject_user_id TEXT NOT NULL,
  token_type TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  FOREIGN KEY (subject_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  target_wins INTEGER,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS match_participants (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  role TEXT NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);

CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  title TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  source_channel_id TEXT NOT NULL,
  suggested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (source_channel_id) REFERENCES channels(id)
);

CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  suggestion_id TEXT NOT NULL,
  voter_twitch_id TEXT NOT NULL,
  source_channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (suggestion_id) REFERENCES suggestions(id),
  FOREIGN KEY (source_channel_id) REFERENCES channels(id)
);

CREATE TABLE IF NOT EXISTS queue_entries (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  suggestion_id TEXT,
  title TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  winner_participant_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (suggestion_id) REFERENCES suggestions(id),
  FOREIGN KEY (winner_participant_id) REFERENCES match_participants(id)
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  queue_entry_id TEXT NOT NULL,
  winner_participant_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (queue_entry_id) REFERENCES queue_entries(id),
  FOREIGN KEY (winner_participant_id) REFERENCES match_participants(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  match_id TEXT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_suggestions_match_id ON suggestions(match_id);
CREATE INDEX IF NOT EXISTS idx_votes_match_id ON votes(match_id);
CREATE INDEX IF NOT EXISTS idx_queue_entries_match_id ON queue_entries(match_id);
