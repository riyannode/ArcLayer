-- 0016_a2a_validations.sql
-- ERC-8004 Validation Registry: request/response tracking with idempotency.
-- Server-only access via service_role (no RLS policies = service_role bypass only).

create table if not exists a2a_validations (
  request_hash text primary key,
  agent_token_id text not null,
  validator_address text not null,
  requester_address text not null,
  task_uri text not null,

  request_tx_hash text,
  request_block_number bigint,

  response_status integer not null default 0,
  result_uri text,
  result_hash text,
  reason text,
  response_tx_hash text,
  response_block_number bigint,
  response_locked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint a2a_validations_response_status_check
    check (response_status in (0, 1, 2))
);

create index if not exists a2a_validations_agent_token_id_idx
  on a2a_validations (agent_token_id);

create index if not exists a2a_validations_validator_address_idx
  on a2a_validations (lower(validator_address));

create index if not exists a2a_validations_response_status_idx
  on a2a_validations (response_status);

create index if not exists a2a_validations_response_locked_at_idx
  on a2a_validations (response_locked_at);

alter table a2a_validations enable row level security;
