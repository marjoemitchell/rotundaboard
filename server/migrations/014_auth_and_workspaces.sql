-- Multi-tenant identity primitives. Nothing here replaces team_members yet
-- (that happens in 015, once these tables exist to repoint the old
-- team_members(id) FK columns at). Session/reset/invite tokens are never
-- stored raw — id/token_hash columns hold a sha256 hex digest of the value
-- that actually goes into a cookie or an emailed link, same principle as
-- password_hash never storing the plaintext password.

CREATE TABLE workspaces (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  color TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two-tier roles (admin/member) — small coalition teams don't need more.
-- The workspace creator becomes the first admin; app code (not a DB
-- constraint) enforces that the last remaining admin can't be demoted or
-- removed.
CREATE TABLE workspace_members (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX idx_workspace_members_workspace ON workspace_members(workspace_id);

-- current_workspace_id is which workspace this browser session is currently
-- "in" for a multi-workspace user — read server-side off the session row on
-- every request, never trusted from a client-supplied value.
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_workspace_id INTEGER REFERENCES workspaces(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);
CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);

-- Unlike sessions/resets, an invite needs to be listed and revoked by an
-- admin in the Settings UI, so it gets its own serial id rather than being
-- addressed only by its token hash.
CREATE TABLE workspace_invites (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_workspace_invites_workspace ON workspace_invites(workspace_id);
