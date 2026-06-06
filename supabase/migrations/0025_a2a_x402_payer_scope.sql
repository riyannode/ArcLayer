-- 0024: A2A x402 payer scope — add scope column to agent_x402_payers
-- ════════════════════════════════════════════════════════════════════════════
-- Adds `scope` column to distinguish A2A vs homepage x402 payer bindings.
-- Updates unique index to (agent_id, rail, scope) so one agent can have
-- separate payers for A2A (Agent Account) and homepage (EOA) on same rail.
--
-- Scope: x402 per-agent payer hardening only. Does NOT modify ERC-8004/ERC-8183.

-- 1. Add scope column with default 'homepage'
ALTER TABLE agent_x402_payers
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'homepage';

-- 2. Add CHECK constraint for scope values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_x402_payers_scope_check'
  ) THEN
    ALTER TABLE agent_x402_payers
      ADD CONSTRAINT agent_x402_payers_scope_check
      CHECK (scope IN ('homepage', 'a2a'));
  END IF;
END $$;

-- 3. Drop old unique index (one active payer per agent per rail)
DROP INDEX IF EXISTS uniq_agent_x402_active_payer;

-- 4. Create new unique index (one active payer per agent per rail per scope)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_x402_active_payer
  ON agent_x402_payers (agent_id, rail, scope)
  WHERE status = 'active' AND revoked_at IS NULL;

-- 5. Index on scope for filtering
CREATE INDEX IF NOT EXISTS idx_agent_x402_payers_scope
  ON agent_x402_payers (scope) WHERE scope = 'a2a';

COMMENT ON COLUMN agent_x402_payers.scope IS
  'Payment scope: homepage (EOA guard) or a2a (agent-to-agent via Circle Agent Account)';
