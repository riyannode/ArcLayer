-- External Agent Bridge event/receipt persistence.
-- Source-of-truth event log for external runtimes posting bridge activity.

create table if not exists public.agent_bridge_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  runtime_id text null,
  agent_id text null,
  role text not null,
  event_type text not null,
  type text generated always as (event_type) stored,
  payload_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb null,
  source text null,
  dry_run boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_bridge_receipts (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  event_id uuid null references public.agent_bridge_events(id) on delete set null,
  receipt_type text not null,
  payload_hash text not null,
  proof_uri text null,
  payment_ref text null,
  payment_id text null,
  transaction text null,
  metadata jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_bridge_events_session_id on public.agent_bridge_events(session_id);
create index if not exists idx_agent_bridge_events_role on public.agent_bridge_events(role);
create index if not exists idx_agent_bridge_events_created_at on public.agent_bridge_events(created_at desc);
create index if not exists idx_agent_bridge_events_runtime_id on public.agent_bridge_events(runtime_id);
create index if not exists idx_agent_bridge_events_event_type on public.agent_bridge_events(event_type);
create index if not exists idx_agent_bridge_events_payload_hash on public.agent_bridge_events(payload_hash);
create index if not exists idx_agent_bridge_receipts_session_id on public.agent_bridge_receipts(session_id);
create index if not exists idx_agent_bridge_receipts_created_at on public.agent_bridge_receipts(created_at desc);

alter table public.agent_bridge_events enable row level security;
alter table public.agent_bridge_receipts enable row level security;

-- Service role owns server-side ingestion/reads. Public access goes through Next.js routes.
