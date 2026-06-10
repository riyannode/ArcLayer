-- MCP onboarding registration intents.
-- Server-only bridge between MCP draft creation and browser wallet mint/finalize.

create table if not exists mcp_registration_intents (
  id uuid primary key default gen_random_uuid(),
  mcp_session_id uuid not null references mcp_sessions(id) on delete cascade,
  owner_address text not null,
  draft_id text not null references agent_metadata_drafts(draft_id) on delete cascade,
  role_preset_id text not null,
  status text not null default 'draft' check (status in ('draft', 'completed', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  agent_id text,
  tx_hash text
);

create index if not exists mcp_registration_intents_owner_idx
  on mcp_registration_intents (owner_address);

create index if not exists mcp_registration_intents_session_idx
  on mcp_registration_intents (mcp_session_id);

create index if not exists mcp_registration_intents_draft_idx
  on mcp_registration_intents (draft_id);

alter table mcp_registration_intents enable row level security;

drop policy if exists mcp_registration_intents_service_role on mcp_registration_intents;
create policy mcp_registration_intents_service_role
  on mcp_registration_intents
  for all
  to service_role
  using (true)
  with check (true);
