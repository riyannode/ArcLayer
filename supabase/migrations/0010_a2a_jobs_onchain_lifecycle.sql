-- ArcLayer A2A -> official Arc ERC-8183 lifecycle mapping.
--
-- This migration extends the persistent A2A off-chain job queue with optional
-- on-chain settlement fields.
--
-- Important:
-- - a2a_jobs.status remains the OFF-CHAIN worker queue state:
--   open | claimed | submitted
-- - a2a_jobs.settlement_status mirrors the OFFICIAL ERC-8183 on-chain status:
--   0 = Created
--   1 = BudgetSet
--   2 = Funded
--   3 = Submitted
--   4 = Completed
-- - There is NO on-chain "Claimed" state in ERC-8183.
--   Claiming is an ArcLayer A2A queue concept only.
-- - budget_atomic is ERC-20 USDC atomic units, 6 decimals.
--   1 USDC = 1_000_000.
--   Do NOT store Arc native gas 18-decimal units here.

alter table a2a_jobs
  add column if not exists onchain_job_id text,
  add column if not exists provider text,
  add column if not exists evaluator text,
  add column if not exists budget_atomic numeric(78, 0),
  add column if not exists fund_tx text,
  add column if not exists submit_tx text,
  add column if not exists complete_tx text,
  add column if not exists settlement_status smallint,
  add column if not exists is_onchain boolean not null default false,
  add column if not exists deliverable_uri text,
  add column if not exists deliverable_hash text,
  add column if not exists proof_uri text;

-- settlement_status must mirror ERC-8183 exactly.
alter table a2a_jobs
  drop constraint if exists a2a_jobs_settlement_status_check;

alter table a2a_jobs
  add constraint a2a_jobs_settlement_status_check
  check (
    settlement_status is null
    or settlement_status in (0, 1, 2, 3, 4)
  );

-- If a job is marked on-chain, it should eventually have an on-chain job id.
-- Kept soft enough for staged create flows: is_onchain can be true before tx sync
-- only if the app intentionally supports pending states later.
-- For now, keep this as indexes/comments instead of a hard constraint.

comment on column a2a_jobs.onchain_job_id is
  'Official Arc ERC-8183 AgenticCommerce jobId. Null means off-chain A2A queue only.';

comment on column a2a_jobs.provider is
  'ERC-8183 provider address expected to submit work for this job.';

comment on column a2a_jobs.evaluator is
  'ERC-8183 evaluator address expected to complete this job.';

comment on column a2a_jobs.budget_atomic is
  'ERC-20 USDC atomic amount, 6 decimals. 1 USDC = 1_000_000. Do not use Arc native 18-decimal gas units.';

comment on column a2a_jobs.fund_tx is
  'Transaction hash for ERC-8183 funding / fund confirmation.';

comment on column a2a_jobs.submit_tx is
  'Transaction hash for ERC-8183 submit(jobId, deliverableHash, optParams).';

comment on column a2a_jobs.complete_tx is
  'Transaction hash for ERC-8183 complete(jobId, reason, optParams).';

comment on column a2a_jobs.settlement_status is
  'ERC-8183 on-chain status: 0 Created, 1 BudgetSet, 2 Funded, 3 Submitted, 4 Completed. No Claimed state.';

comment on column a2a_jobs.is_onchain is
  'True when this A2A job is backed by official Arc ERC-8183 AgenticCommerce.';

comment on column a2a_jobs.deliverable_uri is
  'URI for submitted deliverable, preferably IPFS.';

comment on column a2a_jobs.deliverable_hash is
  'Keccak256 hash of the canonical deliverable bytes submitted to ERC-8183.';

comment on column a2a_jobs.proof_uri is
  'URI for proof metadata / run attestation.';

create index if not exists a2a_jobs_onchain_job_id_idx
  on a2a_jobs (onchain_job_id);

create index if not exists a2a_jobs_is_onchain_idx
  on a2a_jobs (is_onchain, created_at desc);

create index if not exists a2a_jobs_settlement_status_idx
  on a2a_jobs (settlement_status, created_at desc);

create index if not exists a2a_jobs_provider_idx
  on a2a_jobs (provider, created_at desc);

create index if not exists a2a_jobs_evaluator_idx
  on a2a_jobs (evaluator, created_at desc);

create index if not exists a2a_jobs_fund_tx_idx
  on a2a_jobs (fund_tx);

create index if not exists a2a_jobs_submit_tx_idx
  on a2a_jobs (submit_tx);

create index if not exists a2a_jobs_complete_tx_idx
  on a2a_jobs (complete_tx);

notify pgrst, 'reload schema';
