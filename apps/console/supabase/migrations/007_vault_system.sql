-- Migration 007: Vault, Milestones, Disputes, Bonds, Resolver
-- Supports dual-vault architecture with full dispute lifecycle

-- ─── Job Duration Tiers ────────────────────────────────────────────────
CREATE TYPE public.job_duration_tier AS ENUM ('direct_x402', 'single_payout', 'milestone');
CREATE TYPE public.job_vault_status AS ENUM ('open_pool', 'active', 'completed', 'cancelled', 'disputed', 'resolved');
CREATE TYPE public.milestone_status AS ENUM ('created', 'submitted', 'approved', 'rejected', 'released', 'forfeited', 'disputed');
CREATE TYPE public.dispute_outcome AS ENUM ('release', 'refund', 'split');
CREATE TYPE public.dispute_tier AS ENUM ('ai', 'human', 'pool');

-- ─── Vault Jobs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vault_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  on_chain_id BIGINT UNIQUE,              -- maps to contract jobCounter
  client_address TEXT NOT NULL,
  jobber_address TEXT,
  total_amount NUMERIC NOT NULL,
  bond_amount NUMERIC DEFAULT 0,
  released_to_jobber NUMERIC DEFAULT 0,
  refunded_to_client NUMERIC DEFAULT 0,
  milestone_count INT NOT NULL DEFAULT 1,
  duration_tier public.job_duration_tier NOT NULL DEFAULT 'single_payout',
  status public.job_vault_status NOT NULL DEFAULT 'open_pool',
  spec_hash TEXT NOT NULL,                 -- keccak256 of acceptance criteria
  spec_json JSONB,                         -- human-readable spec (title, deliverables, criteria)
  deadline TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  tx_hash_create TEXT,
  tx_hash_accept TEXT
);

CREATE INDEX idx_vault_jobs_client ON public.vault_jobs (lower(client_address));
CREATE INDEX idx_vault_jobs_jobber ON public.vault_jobs (lower(jobber_address));
CREATE INDEX idx_vault_jobs_status ON public.vault_jobs (status);

-- ─── Milestones ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vault_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.vault_jobs(id) ON DELETE CASCADE,
  milestone_index INT NOT NULL,            -- 0-based, matches contract
  amount NUMERIC NOT NULL,
  percentage_bps INT NOT NULL,             -- basis points of total (min 1000 = 10%)
  title TEXT,
  deadline_submit TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  approve_deadline TIMESTAMPTZ,            -- submitted_at + 48hr
  released_at TIMESTAMPTZ,
  revisions INT DEFAULT 0,                 -- max 2 free
  status public.milestone_status NOT NULL DEFAULT 'created',
  deliverable_uri TEXT,                    -- IPFS/URL to deliverable
  feedback_uri TEXT,                       -- client feedback on rejection
  tx_hash_release TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(job_id, milestone_index)
);

CREATE INDEX idx_vault_milestones_job ON public.vault_milestones (job_id);
CREATE INDEX idx_vault_milestones_status ON public.vault_milestones (status);
CREATE INDEX idx_vault_milestones_deadline ON public.vault_milestones (deadline_submit) WHERE status IN ('created', 'rejected');

-- ─── Disputes ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vault_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.vault_jobs(id) ON DELETE CASCADE,
  milestone_id UUID NOT NULL REFERENCES public.vault_milestones(id) ON DELETE CASCADE,
  initiator_address TEXT NOT NULL,
  tier public.dispute_tier NOT NULL DEFAULT 'ai',
  outcome public.dispute_outcome,
  jobber_bps INT,                          -- for split outcome
  client_bps INT,                          -- for split outcome
  reason_uri TEXT,                         -- evidence pointer
  ai_analysis JSONB,                       -- Tier 0 AI output
  ai_confidence NUMERIC,                   -- 0.0 - 1.0
  resolved_by TEXT,                        -- resolver address or 'ai'
  opened_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  tx_hash_resolve TEXT,
  UNIQUE(job_id, milestone_id)
);

CREATE INDEX idx_vault_disputes_job ON public.vault_disputes (job_id);
CREATE INDEX idx_vault_disputes_pending ON public.vault_disputes (tier) WHERE outcome IS NULL;

-- ─── Bond Tiers (admin-configurable, mirrors on-chain BondConfig) ──────
CREATE TABLE IF NOT EXISTS public.bond_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_index INT NOT NULL UNIQUE,
  min_amount NUMERIC NOT NULL,
  max_amount NUMERIC NOT NULL,             -- use 999999999 for uncapped
  bond_type TEXT NOT NULL CHECK (bond_type IN ('flat', 'percentage')),
  bond_value NUMERIC NOT NULL,             -- flat USDC or bps
  active BOOLEAN DEFAULT true,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default 7 tiers
INSERT INTO public.bond_tiers (tier_index, min_amount, max_amount, bond_type, bond_value) VALUES
  (1, 0, 50, 'flat', 0),
  (2, 50, 300, 'flat', 5),
  (3, 300, 500, 'percentage', 100),
  (4, 500, 1000, 'percentage', 200),
  (5, 1000, 2000, 'percentage', 300),
  (6, 2000, 3000, 'percentage', 450),
  (7, 3000, 999999999, 'percentage', 600);

-- ─── Veteran Discount Config ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vault_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.vault_config (key, value) VALUES
  ('veteran_discount', '{"job_threshold": 10, "rating_min": 470, "discount_bps": 3000}'::jsonb),
  ('dispute_window_hours', '48'::jsonb),
  ('miss_grace_hours', '24'::jsonb),
  ('platform_fee_bps', '50'::jsonb),
  ('arbiter_fee_bps', '500'::jsonb),
  ('ai_resolver_confidence_threshold', '0.92'::jsonb),
  ('ai_resolver_model', '"KIRO"'::jsonb),
  ('ai_resolver_endpoint', '"http://localhost:20128/v1"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ─── Resolver Decisions Log (audit trail) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.resolver_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id UUID NOT NULL REFERENCES public.vault_disputes(id),
  tier public.dispute_tier NOT NULL,
  resolver_address TEXT,
  decision public.dispute_outcome NOT NULL,
  jobber_bps INT,
  client_bps INT,
  reasoning TEXT,
  evidence_reviewed JSONB,
  confidence NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Jobber Reputation (for veteran discount + display) ────────────────
CREATE TABLE IF NOT EXISTS public.jobber_reputation (
  address TEXT PRIMARY KEY,
  completed_jobs INT DEFAULT 0,
  total_earned NUMERIC DEFAULT 0,
  disputes_initiated INT DEFAULT 0,
  disputes_won INT DEFAULT 0,
  disputes_lost INT DEFAULT 0,
  ghosted_count INT DEFAULT 0,
  avg_rating NUMERIC DEFAULT 0,           -- 0-500 (x100)
  rating_count INT DEFAULT 0,
  last_job_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Client Reputation ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_reputation (
  address TEXT PRIMARY KEY,
  jobs_posted INT DEFAULT 0,
  jobs_completed INT DEFAULT 0,
  total_spent NUMERIC DEFAULT 0,
  disputes_initiated INT DEFAULT 0,
  disputes_won INT DEFAULT 0,
  disputes_lost INT DEFAULT 0,
  avg_rating NUMERIC DEFAULT 0,
  rating_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
