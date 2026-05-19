-- Phase 14: Webhook subscriptions table
create table if not exists a2a_webhooks (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null,
  url text not null,
  secret text not null,
  events text[] not null default '{"job.created","job.claimed","job.submitted"}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_a2a_webhooks_agent on a2a_webhooks(agent_id);
create index if not exists idx_a2a_webhooks_active on a2a_webhooks(active) where active = true;

-- Delivery log for retry tracking
create table if not exists a2a_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references a2a_webhooks(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts int not null default 0,
  last_attempt_at timestamptz,
  response_status int,
  response_body text,
  created_at timestamptz not null default now()
);

create index if not exists idx_a2a_webhook_deliveries_pending on a2a_webhook_deliveries(status) where status = 'pending' or status = 'retrying';
