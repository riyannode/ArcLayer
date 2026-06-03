-- 0021: add rejecting/rejected to agent_jobs status CHECK constraint
-- Required for the evaluator reject flow (status='rejecting' during tx,
-- status='rejected' after on-chain confirmation).
-- Safe to run multiple times: drops old constraint, adds new one.

ALTER TABLE agent_jobs DROP CONSTRAINT IF EXISTS agent_jobs_status_check;

ALTER TABLE agent_jobs ADD CONSTRAINT agent_jobs_status_check
  CHECK (status IN (
    'created',
    'claimed',
    'running',
    'submitted',
    'verified',
    'settlement_pending',
    'settled',
    'failed',
    'cancelled',
    'expired',
    'rejecting',
    'rejected'
  ));
