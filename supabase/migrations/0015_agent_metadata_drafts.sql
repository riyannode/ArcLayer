-- 012_agent_metadata_drafts.sql
-- Metadata draft system for ERC-8004 agent registration.
-- Stores draft metadata before on-chain mint, then patches with minted agentId + txHash.
-- Server-only access via service_role (no RLS policies = service_role bypass only).

create table if not exists agent_metadata_drafts (
  draft_id text primary key,
  controller text not null,
  metadata jsonb not null,
  status text not null default 'draft'
    check (status in ('draft', 'minted')),
  agent_id text,
  tx_hash text,
  write_token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_metadata_drafts_controller_idx
  on agent_metadata_drafts (controller);

create index if not exists agent_metadata_drafts_agent_id_idx
  on agent_metadata_drafts (agent_id);

create index if not exists agent_metadata_drafts_status_created_idx
  on agent_metadata_drafts (status, created_at);

alter table agent_metadata_drafts enable row level security;

create or replace function agent_metadata_drafts_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists agent_metadata_drafts_touch on agent_metadata_drafts;

create trigger agent_metadata_drafts_touch
  before update on agent_metadata_drafts
  for each row
  execute function agent_metadata_drafts_touch_updated_at();
