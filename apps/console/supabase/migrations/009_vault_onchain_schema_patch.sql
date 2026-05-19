-- Migration 009: Vault on-chain schema patch (idempotent re-assert)
-- Purpose: defensive re-apply of 008 fields plus tx_hash_create for any
-- environment that drifted (live Supabase reported missing on_chain_job_id).
-- Append-only — does NOT edit migration 008.

ALTER TABLE public.vault_jobs
  ADD COLUMN IF NOT EXISTS on_chain_job_id TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash_create TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash_approve TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash_deposit TEXT;

CREATE INDEX IF NOT EXISTS idx_vault_jobs_on_chain_job_id
  ON public.vault_jobs (on_chain_job_id);

-- Force PostgREST to refresh its schema cache so /api/vault/jobs
-- can immediately see the new columns without restarting the API.
NOTIFY pgrst, 'reload schema';
