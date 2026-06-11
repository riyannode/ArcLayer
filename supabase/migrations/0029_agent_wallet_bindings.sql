-- 0029: Agent Wallet identity binding — agent_id → agent_account_address mapping
-- Persists the production-grade binding after ERC-8004 mint.
-- owner_address = EOA (funding wallet)
-- agent_account_address = Circle Agent Wallet (ERC-8004 controller)

CREATE TABLE IF NOT EXISTS arclayer_agent_wallet_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  owner_address text NOT NULL,
  agent_id text NOT NULL,
  agent_account_address text NOT NULL,

  controller_mode text NOT NULL DEFAULT 'agent-account',
  chain_id integer NOT NULL DEFAULT 5042002,
  registration_tx_hash text NULL,
  metadata_uri text NULL,

  status text NOT NULL DEFAULT 'active',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT arclayer_agent_wallet_bindings_controller_mode_check
    CHECK (controller_mode IN ('agent-account', 'eoa')),

  CONSTRAINT arclayer_agent_wallet_bindings_status_check
    CHECK (status IN ('active', 'inactive'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_wallet_bindings_owner
  ON arclayer_agent_wallet_bindings (owner_address);

CREATE INDEX IF NOT EXISTS idx_agent_wallet_bindings_agent
  ON arclayer_agent_wallet_bindings (agent_id);

CREATE INDEX IF NOT EXISTS idx_agent_wallet_bindings_wallet
  ON arclayer_agent_wallet_bindings (agent_account_address);

-- One active binding per agent_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_wallet_bindings_agent_active
  ON arclayer_agent_wallet_bindings (agent_id)
  WHERE status = 'active';

-- RLS
ALTER TABLE arclayer_agent_wallet_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_wallet_bindings_service_role ON arclayer_agent_wallet_bindings;

CREATE POLICY agent_wallet_bindings_service_role
  ON arclayer_agent_wallet_bindings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
