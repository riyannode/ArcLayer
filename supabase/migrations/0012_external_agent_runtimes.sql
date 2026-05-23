-- External Agent Runtime registry for external PM2 market agent bridge example.
-- Stores runtime identity/metadata only. Never store LLM API keys, private keys, exchange keys, or bot secrets.

create table if not exists public.external_agent_runtimes (
  id uuid primary key default gen_random_uuid(),
  runtime_id text not null unique,
  agent_id text not null,
  owner text null,
  name text null,
  role text null,
  category text null,
  endpoint text null,
  status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.agent_bridge_events
  add column if not exists job_id text null,
  add column if not exists category text null;

create index if not exists idx_external_agent_runtimes_agent_id on public.external_agent_runtimes(agent_id);
create index if not exists idx_external_agent_runtimes_runtime_id on public.external_agent_runtimes(runtime_id);
create index if not exists idx_external_agent_runtimes_role on public.external_agent_runtimes(role);
create index if not exists idx_external_agent_runtimes_category on public.external_agent_runtimes(category);
create index if not exists idx_external_agent_runtimes_status on public.external_agent_runtimes(status);
create index if not exists idx_external_agent_runtimes_last_seen_at on public.external_agent_runtimes(last_seen_at desc);

create index if not exists idx_agent_bridge_events_job_id on public.agent_bridge_events(job_id);
create index if not exists idx_agent_bridge_events_category on public.agent_bridge_events(category);

alter table public.external_agent_runtimes enable row level security;

-- Service role only; public access goes through Next.js API routes.
drop policy if exists external_agent_runtimes_service_role on public.external_agent_runtimes;
create policy external_agent_runtimes_service_role
  on public.external_agent_runtimes
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
