-- 0023_mcp_sessions_agent_accounts.sql
-- MCP session tokens and agent account bindings for agentic commerce.
-- Sessions: token-hash-only storage (raw token returned once on creation).
-- Agent accounts: links owner wallet → Circle Smart Account (agent account).

-- ── Agent accounts table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS arclayer_agent_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_address         text NOT NULL,
  agent_account_address text NOT NULL,
  wallet_provider       text NOT NULL DEFAULT 'circle_modular',
  account_type          text NOT NULL DEFAULT 'circle_smart_account',
  chain_id              integer NOT NULL DEFAULT 5042002,
  status                text NOT NULL DEFAULT 'active',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Lookup by owner (primary read path: "what agent accounts does this wallet own?")
CREATE INDEX IF NOT EXISTS idx_agent_accounts_owner
  ON arclayer_agent_accounts (owner_address);

-- Lookup by agent account address (resolve owner from agent account)
CREATE INDEX IF NOT EXISTS idx_agent_accounts_address
  ON arclayer_agent_accounts (agent_account_address);

-- One active agent account per owner (soft-enforced via partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_accounts_owner_active
  ON arclayer_agent_accounts (owner_address)
  WHERE status = 'active';

-- ── MCP sessions table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mcp_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash             text NOT NULL UNIQUE,
  owner_address          text NOT NULL,
  agent_account_address  text NOT NULL,
  permissions_json       jsonb NOT NULL DEFAULT '{}',
  auto_approve           boolean NOT NULL DEFAULT false,
  expires_at             timestamptz NOT NULL,
  revoked_at             timestamptz NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  last_used_at           timestamptz NULL
);

-- Lookup by token hash (primary read path on every MCP request)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_sessions_token_hash
  ON mcp_sessions (token_hash);

-- Lookup by owner (list sessions per wallet)
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_owner
  ON mcp_sessions (owner_address);

-- Lookup by agent account (list sessions per agent account)
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_agent_account
  ON mcp_sessions (agent_account_address);

-- Expiry sweep
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_expires_at
  ON mcp_sessions (expires_at);

-- Active sessions filter
CREATE INDEX IF NOT EXISTS idx_mcp_sessions_revoked_at
  ON mcp_sessions (revoked_at) WHERE revoked_at IS NULL;

-- ── RLS: service role only ──────────────────────────────────────────────────
-- Both tables are sensitive (session tokens, account bindings).
-- RLS locked to service_role only — matches 0018_wallet_auth_sessions pattern.

ALTER TABLE arclayer_agent_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_accounts_service_role ON arclayer_agent_accounts;
CREATE POLICY agent_accounts_service_role
  ON arclayer_agent_accounts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE mcp_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_sessions_service_role ON mcp_sessions;
CREATE POLICY mcp_sessions_service_role
  ON mcp_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
