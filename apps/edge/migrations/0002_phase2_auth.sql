CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS channel_links (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  owner_channel_id TEXT NOT NULL,
  invited_channel_login TEXT NOT NULL,
  linked_channel_id TEXT,
  pair_key TEXT UNIQUE,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_channel_id) REFERENCES channels(id),
  FOREIGN KEY (linked_channel_id) REFERENCES channels(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS channel_link_invites (
  id TEXT PRIMARY KEY,
  channel_link_id TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL UNIQUE,
  code_ciphertext TEXT NOT NULL,
  invited_channel_login TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  claimed_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_link_id) REFERENCES channel_links(id),
  FOREIGN KEY (claimed_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS channel_link_memberships (
  id TEXT PRIMARY KEY,
  channel_link_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_link_id) REFERENCES channel_links(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id),
  UNIQUE(channel_link_id, user_id)
);

ALTER TABLE twitch_tokens ADD COLUMN scopes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE matches ADD COLUMN channel_link_id TEXT REFERENCES channel_links(id);
ALTER TABLE audit_log ADD COLUMN channel_link_id TEXT REFERENCES channel_links(id);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_links_owner_channel_id ON channel_links(owner_channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_link_memberships_link_id ON channel_link_memberships(channel_link_id);
CREATE INDEX IF NOT EXISTS idx_channel_link_memberships_user_id ON channel_link_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_matches_channel_link_id ON matches(channel_link_id);
