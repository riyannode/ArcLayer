-- 0018_wallet_auth_sessions.sql
-- Wallet auth nonce + session storage for external non-dev users.
-- Supports durable sessions across serverless instances (Vercel/serverless).

-- ── Nonce table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wallet_auth_nonces (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce_hash   text NOT NULL UNIQUE,
  controller   text NOT NULL,
  message      text NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Lookup by nonce hash (primary read path on verify)
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_auth_nonces_nonce_hash
  ON wallet_auth_nonces (nonce_hash);

-- Lookup by controller (optional: list nonces per wallet)
CREATE INDEX IF NOT EXISTS idx_wallet_auth_nonces_controller
  ON wallet_auth_nonces (controller);

-- Expiry sweep
CREATE INDEX IF NOT EXISTS idx_wallet_auth_nonces_expires_at
  ON wallet_auth_nonces (expires_at);

-- Unused nonces (for partial queries / cleanup)
CREATE INDEX IF NOT EXISTS idx_wallet_auth_nonces_used_at
  ON wallet_auth_nonces (used_at) WHERE used_at IS NULL;

-- ── Session table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wallet_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_hash  text NOT NULL UNIQUE,
  controller    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NULL
);

-- Lookup by session hash (primary read path on every request)
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_sessions_session_hash
  ON wallet_sessions (session_hash);

-- Lookup by controller (list sessions per wallet)
CREATE INDEX IF NOT EXISTS idx_wallet_sessions_controller
  ON wallet_sessions (controller);

-- Expiry sweep
CREATE INDEX IF NOT EXISTS idx_wallet_sessions_expires_at
  ON wallet_sessions (expires_at);

-- Active sessions filter
CREATE INDEX IF NOT EXISTS idx_wallet_sessions_revoked_at
  ON wallet_sessions (revoked_at) WHERE revoked_at IS NULL;

-- ── RLS: service role only ────────────────────────────────────────────────
-- wallet_auth_nonces and wallet_sessions are sensitive.
-- Hashed values still leak login/session activity.
-- RLS locked to service_role only — matches 0009_a2a_api_keys pattern.

ALTER TABLE wallet_auth_nonces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_auth_nonces_service_role ON wallet_auth_nonces;
CREATE POLICY wallet_auth_nonces_service_role
  ON wallet_auth_nonces
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE wallet_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallet_sessions_service_role ON wallet_sessions;
CREATE POLICY wallet_sessions_service_role
  ON wallet_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
