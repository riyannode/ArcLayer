-- 0022: x402 per-agent payer binding + payment ledger + gateway payments safety
-- Creates agent_x402_payers (per-agent payer EOA mapping, no private keys)
-- Creates agent_x402_payment_ledger (x402 payment audit trail)
-- Guarded: ensures x402_gateway_payments base table + RPC functions exist
-- Extends x402_gateway_payments with agent context columns
--
-- Scope: x402 Circle Gateway per-agent payer hardening only.
-- No ERC-8004, ERC-8183, or contract changes.

-- ── 0. Ensure x402_gateway_payments base table exists ────────────────────────
-- Table may already exist (created manually in Supabase dashboard).
-- CREATE TABLE IF NOT EXISTS is safe for both cases.

CREATE TABLE IF NOT EXISTS x402_gateway_payments (
  payment_id              text PRIMARY KEY,
  status                  text NOT NULL DEFAULT 'verified',
  payer                   text,
  pay_to                  text,
  amount                  text,
  asset                   text,
  network                 text,
  resource                text,
  gateway_settlement_id   text,
  verify_payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  settle_payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at             timestamptz,
  settled_at              timestamptz,
  settlement_claimed_at   timestamptz,
  consumed_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ── 0b. RPC: atomic consume (idempotent) ────────────────────────────────────

CREATE OR REPLACE FUNCTION x402_gateway_consume_payment(p_payment_id text)
RETURNS TABLE(ok boolean, reason text, status text, consumed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row x402_gateway_payments%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM x402_gateway_payments
  WHERE payment_id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'missing'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_row.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'replayed'::text, v_row.status, v_row.consumed_at;
    RETURN;
  END IF;

  UPDATE x402_gateway_payments
  SET consumed_at = now(), updated_at = now()
  WHERE payment_id = p_payment_id;

  RETURN QUERY SELECT true, NULL::text, v_row.status, now();
END;
$$;

-- ── 0c. RPC: atomic claim settlement (prevents double-settle) ───────────────

CREATE OR REPLACE FUNCTION x402_gateway_claim_settlement(
  p_payment_id text,
  p_payer text DEFAULT NULL,
  p_pay_to text DEFAULT NULL,
  p_amount text DEFAULT NULL,
  p_asset text DEFAULT NULL,
  p_network text DEFAULT NULL,
  p_resource text DEFAULT NULL,
  p_verify_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(ok boolean, reason text, status text, gateway_settlement_id text, settlement_claimed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row x402_gateway_payments%ROWTYPE;
BEGIN
  -- Try to insert or update
  INSERT INTO x402_gateway_payments (
    payment_id, status, payer, pay_to, amount, asset, network, resource, verify_payload, settlement_claimed_at
  ) VALUES (
    p_payment_id, 'accepted_pending_settlement', p_payer, p_pay_to, p_amount, p_asset, p_network, p_resource, p_verify_payload, now()
  )
  ON CONFLICT (payment_id) DO UPDATE
  SET settlement_claimed_at = CASE
    WHEN x402_gateway_payments.settlement_claimed_at IS NULL THEN now()
    ELSE x402_gateway_payments.settlement_claimed_at
  END,
  updated_at = now()
  RETURNING * INTO v_row;

  -- Check if we won the claim
  IF v_row.settlement_claimed_at = now() AND v_row.status = 'accepted_pending_settlement' THEN
    RETURN QUERY SELECT true, NULL::text, v_row.status, v_row.gateway_settlement_id, v_row.settlement_claimed_at;
    RETURN;
  END IF;

  -- Someone else already claimed
  IF v_row.status = 'settled' THEN
    RETURN QUERY SELECT false, 'already_settled'::text, v_row.status, v_row.gateway_settlement_id, v_row.settlement_claimed_at;
  ELSIF v_row.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'consumed'::text, v_row.status, v_row.gateway_settlement_id, v_row.settlement_claimed_at;
  ELSIF v_row.status = 'failed' THEN
    RETURN QUERY SELECT false, 'failed'::text, v_row.status, v_row.gateway_settlement_id, v_row.settlement_claimed_at;
  ELSE
    RETURN QUERY SELECT false, 'in_flight'::text, v_row.status, v_row.gateway_settlement_id, v_row.settlement_claimed_at;
  END IF;
END;
$$;

-- ── 0d. Extend x402_gateway_payments with agent context columns ─────────────

ALTER TABLE x402_gateway_payments ADD COLUMN IF NOT EXISTS agent_id text;
ALTER TABLE x402_gateway_payments ADD COLUMN IF NOT EXISTS runtime_id text;
ALTER TABLE x402_gateway_payments ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE x402_gateway_payments ADD COLUMN IF NOT EXISTS job_id text;
ALTER TABLE x402_gateway_payments ADD COLUMN IF NOT EXISTS expected_payer text;
ALTER TABLE x402_gateway_payments ADD COLUMN IF NOT EXISTS payer_verified boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_x402_gateway_payments_agent
  ON x402_gateway_payments (agent_id) WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_x402_gateway_payments_job
  ON x402_gateway_payments (job_id) WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_x402_gateway_payments_expected_payer
  ON x402_gateway_payments (expected_payer) WHERE expected_payer IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- 1. agent_x402_payers — per-agent x402 payer EOA mapping
-- ════════════════════════════════════════════════════════════════════════════
-- Only public payer addresses. NEVER stores private keys.
-- Each agent has at most ONE active payer per rail.

CREATE TABLE IF NOT EXISTS agent_x402_payers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          text NOT NULL,
  controller_address text NOT NULL,
  payer_address     text NOT NULL,
  rail              text NOT NULL DEFAULT 'circle-gateway',
  status            text NOT NULL DEFAULT 'active',
  verified_at       timestamptz,
  revoked_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_x402_payers_rail_check
    CHECK (rail IN ('circle-gateway', 'arc-native')),
  CONSTRAINT agent_x402_payers_status_check
    CHECK (status IN ('active', 'revoked'))
);

-- One active payer per agent per rail
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_x402_active_payer
  ON agent_x402_payers (agent_id, rail)
  WHERE status = 'active' AND revoked_at IS NULL;

-- Lookup by agent
CREATE INDEX IF NOT EXISTS idx_agent_x402_payers_agent
  ON agent_x402_payers (agent_id);

-- Lookup by controller
CREATE INDEX IF NOT EXISTS idx_agent_x402_payers_controller
  ON agent_x402_payers (controller_address);

-- Lookup by payer address
CREATE INDEX IF NOT EXISTS idx_agent_x402_payers_payer
  ON agent_x402_payers (payer_address);


-- ════════════════════════════════════════════════════════════════════════════
-- 2. agent_x402_payment_ledger — x402 payment audit trail
-- ════════════════════════════════════════════════════════════════════════════
-- Records every x402 payment attempt with agent context.
-- NOT tied to ERC-8183 job lifecycle (separate concern).

CREATE TABLE IF NOT EXISTS agent_x402_payment_ledger (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          text NOT NULL,
  controller_address text NOT NULL,
  payer_address     text NOT NULL,
  expected_payer    text NOT NULL,
  runtime_id        text,
  session_id        text,
  job_id            text,
  resource          text NOT NULL,
  rail              text NOT NULL DEFAULT 'circle-gateway',
  amount            text NOT NULL,
  currency          text NOT NULL DEFAULT 'USDC',
  payment_id        text,
  settlement_ref    text,
  tx_hash           text,
  status            text NOT NULL,
  receipt           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_x402_payment_ledger_rail_check
    CHECK (rail IN ('circle-gateway', 'arc-native')),
  CONSTRAINT agent_x402_payment_ledger_status_check
    CHECK (status IN ('verified', 'settled', 'consumed', 'failed', 'replayed'))
);

-- Primary read: agent payments sorted by time
CREATE INDEX IF NOT EXISTS idx_agent_x402_payment_ledger_agent
  ON agent_x402_payment_ledger (agent_id, created_at DESC);

-- Lookup by job
CREATE INDEX IF NOT EXISTS idx_agent_x402_payment_ledger_job
  ON agent_x402_payment_ledger (job_id, created_at DESC)
  WHERE job_id IS NOT NULL;

-- Lookup by payer
CREATE INDEX IF NOT EXISTS idx_agent_x402_payment_ledger_payer
  ON agent_x402_payment_ledger (payer_address, created_at DESC);


-- ── RLS: service_role only ──────────────────────────────────────────────────
-- Matches existing pattern (0018, 0009). Payer addresses are public on-chain
-- but we restrict DB access to service_role for consistency.

ALTER TABLE agent_x402_payers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_x402_payers_service_role ON agent_x402_payers;
CREATE POLICY agent_x402_payers_service_role
  ON agent_x402_payers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE agent_x402_payment_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_x402_payment_ledger_service_role ON agent_x402_payment_ledger;
CREATE POLICY agent_x402_payment_ledger_service_role
  ON agent_x402_payment_ledger
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
