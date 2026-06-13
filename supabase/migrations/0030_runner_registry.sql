-- Runner Registry: stores registered runners that Console can dispatch tasks to.
-- Each runner has an HMAC secret, endpoint, and allowed roles.
-- HMAC secret is stored as service-role-only bytea for MVP.
-- For production: use pgcrypto/KMS or secret reference pattern.

create table if not exists public.runner_registry (
  id uuid primary key default gen_random_uuid(),
  runner_id text not null unique,
  agent_id text not null,
  name text null,
  endpoint text not null,
  allowed_roles text[] not null default '{provider}',
  default_role text not null default 'provider',
  status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  runtime_kind text not null default 'openclaw' check (runtime_kind in ('hermes', 'openclaw', 'custom')),
  
  -- HMAC secret for signing dispatch requests. Stored as raw bytes (bytea).
  -- NOT encrypted at rest — protected by service_role RLS only.
  -- For production: use pgcrypto/KMS or secret reference pattern.
  hmac_secret bytea null,
  
  -- Metadata: Circle wallet address, chain, policy overrides, etc.
  metadata jsonb not null default '{}'::jsonb,
  
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_runner_registry_agent_id on public.runner_registry(agent_id);
create index if not exists idx_runner_registry_status on public.runner_registry(status);
create index if not exists idx_runner_registry_runner_id on public.runner_registry(runner_id);

-- RLS: service role only
alter table public.runner_registry enable row level security;

drop policy if exists runner_registry_service_role on public.runner_registry;
create policy runner_registry_service_role
  on public.runner_registry
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Dispatch log: records every HMAC-signed dispatch and its result.
create table if not exists public.runner_dispatch_log (
  id uuid primary key default gen_random_uuid(),
  dispatch_id text not null unique,
  runner_id text not null,
  agent_id text not null,
  task_id text not null,
  role text not null default 'provider',
  
  -- Request
  request_path text not null,
  request_body_hash text not null,
  hmac_nonce text not null,
  hmac_timestamp text not null,
  
  -- Response
  status_code integer,
  response_body jsonb,
  error text,
  
  -- Proof
  proof_sha256 text,
  
  created_at timestamptz not null default now()
);

create index if not exists idx_runner_dispatch_log_runner_id on public.runner_dispatch_log(runner_id);
create index if not exists idx_runner_dispatch_log_agent_id on public.runner_dispatch_log(agent_id);
create index if not exists idx_runner_dispatch_log_task_id on public.runner_dispatch_log(task_id);
create index if not exists idx_runner_dispatch_log_created_at on public.runner_dispatch_log(created_at desc);

alter table public.runner_dispatch_log enable row level security;

drop policy if exists runner_dispatch_log_service_role on public.runner_dispatch_log;
create policy runner_dispatch_log_service_role
  on public.runner_dispatch_log
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
