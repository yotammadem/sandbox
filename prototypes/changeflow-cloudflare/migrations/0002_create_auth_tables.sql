CREATE TABLE IF NOT EXISTS github_users (
  github_user_id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS user_sessions (
  session_hash TEXT PRIMARY KEY NOT NULL,
  github_user_id INTEGER NOT NULL REFERENCES github_users(github_user_id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (github_user_id, expires_at);
