-- 0020: erc8183_reject_columns — add reject fields to agent_jobs
-- Supports the evaluator reject flow for ERC-8183 jobs.
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE agent_jobs
  ADD COLUMN IF NOT EXISTS reject_tx_hash       text,
  ADD COLUMN IF NOT EXISTS rejected_at           timestamptz,
  ADD COLUMN IF NOT EXISTS reject_reason_text    text,
  ADD COLUMN IF NOT EXISTS reject_reason_hash    text;

-- Index for reject tx hash lookups (partial — only non-null)
CREATE INDEX IF NOT EXISTS idx_agent_jobs_reject_tx_hash
  ON agent_jobs (reject_tx_hash)
  WHERE reject_tx_hash IS NOT NULL;
