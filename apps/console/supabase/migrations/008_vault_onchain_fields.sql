-- Vault on-chain integration fields
-- Adds tx hashes and on-chain IDs required by frontend ArcVault integration.

ALTER TABLE public.vault_jobs
  ADD COLUMN IF NOT EXISTS on_chain_job_id TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash_approve TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash_deposit TEXT;

CREATE INDEX IF NOT EXISTS idx_vault_jobs_on_chain_job_id ON public.vault_jobs (on_chain_job_id);
