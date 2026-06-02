-- 0019: erc8183_hire_preparations — direct hire preparation persistence
-- Stores validated hire preparation records between /prepare and /created calls.
-- RLS enabled, service_role-only access (no anon).

CREATE TABLE IF NOT EXISTS erc8183_hire_preparations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_agent_id       text NOT NULL,
  provider_agent_id    text NOT NULL,
  evaluator_agent_id   text,
  evaluator_mode       text NOT NULL,
  buyer_controller     text NOT NULL,
  provider_controller  text NOT NULL,
  evaluator_controller text NOT NULL,
  budget_atomic        text NOT NULL,
  expired_at_unix      text NOT NULL,
  description          text NOT NULL,
  hook                 text NOT NULL,
  input_payload_hash   text NOT NULL,
  prepared_by_wallet   text,
  status               text NOT NULL DEFAULT 'prepared',
  create_tx_hash       text,
  erc8183_job_id       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hire_prep_id          ON erc8183_hire_preparations (id);
CREATE INDEX IF NOT EXISTS idx_hire_prep_buyer       ON erc8183_hire_preparations (buyer_agent_id);
CREATE INDEX IF NOT EXISTS idx_hire_prep_provider    ON erc8183_hire_preparations (provider_agent_id);
CREATE INDEX IF NOT EXISTS idx_hire_prep_status      ON erc8183_hire_preparations (status);
CREATE INDEX IF NOT EXISTS idx_hire_prep_expires     ON erc8183_hire_preparations (expires_at);
CREATE INDEX IF NOT EXISTS idx_hire_prep_tx_hash     ON erc8183_hire_preparations (create_tx_hash);

-- RLS: enabled, service_role-only (no anon policy)
ALTER TABLE erc8183_hire_preparations ENABLE ROW LEVEL SECURITY;

-- service_role can do everything (Supabase admin client bypasses RLS anyway,
-- but this makes the intent explicit)
CREATE POLICY service_role_all_erc8183_hire_preparations
  ON erc8183_hire_preparations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
