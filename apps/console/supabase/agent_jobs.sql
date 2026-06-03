-- Agent Jobs lifecycle tables
-- Fullcycle: create → claim → running → submit → verify → settlement_pending → settle
-- Arc native x402 settlement for final verified job payment

-- ─── agent_jobs ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          text UNIQUE NOT NULL,
  job_type        text NOT NULL,
  market_id       text,
  buyer_agent_id  text NOT NULL,
  provider_agent_id text,
  worker_id       text,
  status          text NOT NULL CHECK (status IN (
    'created',
    'claimed',
    'running',
    'submitted',
    'verified',
    'settlement_pending',
    'settled',
    'failed',
    'cancelled',
    'expired'
  )),
  input_payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_payload_hash   text NOT NULL,
  result_payload       jsonb,
  result_payload_hash  text,
  proof_payload        jsonb,
  proof_payload_hash   text,
  price_atomic         text NOT NULL DEFAULT '0',
  asset                text NOT NULL DEFAULT 'USDC',
  chain_id             text NOT NULL DEFAULT '5042002',
  settlement_payment_id text,
  settlement_tx_hash   text,
  settlement_payer     text,
  settlement_pay_to    text,
  error                text,
  claim_expires_at     timestamptz,
  deadline_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  claimed_at           timestamptz,
  started_at           timestamptz,
  submitted_at         timestamptz,
  verified_at          timestamptz,
  settlement_pending_at timestamptz,
  settled_at           timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Indexes for 24/7 worker polling and filtering
CREATE INDEX IF NOT EXISTS idx_agent_jobs_job_id ON public.agent_jobs (job_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON public.agent_jobs (status);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_job_type ON public.agent_jobs (job_type);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_market_id ON public.agent_jobs (market_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_buyer_agent_id ON public.agent_jobs (buyer_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_provider_agent_id ON public.agent_jobs (provider_agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_worker_id ON public.agent_jobs (worker_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_claim_expires_at ON public.agent_jobs (claim_expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_settlement_payment_id ON public.agent_jobs (settlement_payment_id);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_settlement_tx_hash ON public.agent_jobs (settlement_tx_hash);

-- ─── agent_job_events ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_job_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          text NOT NULL,
  event_type      text NOT NULL,
  actor_agent_id  text NOT NULL,
  status_before   text,
  status_after    text,
  payload_hash    text,
  payment_id      text,
  tx_hash         text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── claim_agent_job function ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_agent_job(
  p_job_type text,
  p_worker_id text,
  p_provider_agent_id text,
  p_claim_ttl_seconds int DEFAULT 300
) RETURNS SETOF public.agent_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  v_job public.agent_jobs%ROWTYPE;
BEGIN
  -- Atomically claim one available job using SKIP LOCKED
  SELECT * INTO v_job
  FROM public.agent_jobs
  WHERE ( status = 'created' OR (status = 'claimed' AND claim_expires_at < now()) )
    AND COALESCE(settlement_mode, 'x402_offchain') = 'x402_offchain'
    AND (COALESCE(p_job_type, '') = '' OR job_type = p_job_type)
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.agent_jobs
  SET
    status = 'claimed',
    worker_id = p_worker_id,
    provider_agent_id = p_provider_agent_id,
    claimed_at = now(),
    claim_expires_at = now() + (p_claim_ttl_seconds || ' seconds')::interval,
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN NEXT v_job;
END;
$$;

-- ─── job status history trigger ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_agent_job_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.agent_job_events (job_id, event_type, actor_agent_id, status_before, status_after, metadata)
    VALUES (
      NEW.job_id,
      'status_change',
      COALESCE(NEW.worker_id, NEW.buyer_agent_id, 'system'),
      OLD.status,
      NEW.status,
      jsonb_build_object('event_type', 'status_change', 'status_before', OLD.status, 'status_after', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_job_event ON public.agent_jobs;
CREATE TRIGGER trg_agent_job_event
  AFTER UPDATE OF status ON public.agent_jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.log_agent_job_event();

-- ─── ERC-8183 Escrow columns (additive migration) ────────────────────────────

ALTER TABLE public.agent_jobs
ADD COLUMN IF NOT EXISTS settlement_mode text NOT NULL DEFAULT 'x402_offchain'
  CHECK (settlement_mode IN ('x402_offchain', 'erc8183_escrow')),
ADD COLUMN IF NOT EXISTS erc8183_job_id text,
ADD COLUMN IF NOT EXISTS erc8183_status text,
ADD COLUMN IF NOT EXISTS client_address text,
ADD COLUMN IF NOT EXISTS provider_address text,
ADD COLUMN IF NOT EXISTS evaluator_agent_id text,
ADD COLUMN IF NOT EXISTS evaluator_address text,
ADD COLUMN IF NOT EXISTS hook_address text,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS expired_at_unix text,
ADD COLUMN IF NOT EXISTS deliverable_hash text,
ADD COLUMN IF NOT EXISTS reason_hash text,
ADD COLUMN IF NOT EXISTS create_tx_hash text,
ADD COLUMN IF NOT EXISTS set_budget_tx_hash text,
ADD COLUMN IF NOT EXISTS approve_tx_hash text,
ADD COLUMN IF NOT EXISTS fund_tx_hash text,
ADD COLUMN IF NOT EXISTS submit_tx_hash text,
ADD COLUMN IF NOT EXISTS complete_tx_hash text,
ADD COLUMN IF NOT EXISTS reject_tx_hash text,
ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
ADD COLUMN IF NOT EXISTS reject_reason_text text,
ADD COLUMN IF NOT EXISTS reject_reason_hash text;

-- Indexes for ERC-8183 queries
CREATE INDEX IF NOT EXISTS idx_agent_jobs_settlement_mode
  ON public.agent_jobs (settlement_mode);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_erc8183_job_id
  ON public.agent_jobs (erc8183_job_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_jobs_erc8183_job_id_not_null
  ON public.agent_jobs (erc8183_job_id)
  WHERE erc8183_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_jobs_reject_tx_hash
  ON public.agent_jobs (reject_tx_hash)
  WHERE reject_tx_hash IS NOT NULL;
