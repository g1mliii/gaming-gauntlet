PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lobbies (
  id TEXT PRIMARY KEY NOT NULL,
  player_one_name TEXT NOT NULL CHECK (length(trim(player_one_name)) BETWEEN 1 AND 40),
  player_two_name TEXT NOT NULL CHECK (length(trim(player_two_name)) BETWEEN 1 AND 40),
  player_one_score INTEGER NOT NULL DEFAULT 0 CHECK (player_one_score >= 0),
  player_two_score INTEGER NOT NULL DEFAULT 0 CHECK (player_two_score >= 0),
  target_score INTEGER CHECK (target_score IS NULL OR target_score BETWEEN 1 AND 99),
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'ready', 'playing', 'complete')),
  current_game_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY NOT NULL,
  lobby_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
  position INTEGER NOT NULL CHECK (position >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lobby_id) REFERENCES lobbies(id) ON DELETE CASCADE,
  UNIQUE (lobby_id, position)
);

CREATE TABLE IF NOT EXISTS lobby_secrets (
  lobby_id TEXT PRIMARY KEY NOT NULL,
  management_code_hash TEXT NOT NULL CHECK (
    length(management_code_hash) = 71
    AND substr(management_code_hash, 1, 7) = 'sha256:'
    AND substr(management_code_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lobby_id) REFERENCES lobbies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_games_lobby_id ON games(lobby_id);
CREATE INDEX IF NOT EXISTS idx_lobbies_updated_at ON lobbies(updated_at);
