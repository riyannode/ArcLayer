-- Agent bridge storage for external PM2 trading bots.
-- Stores only event payloads, payload hashes, and receipt metadata.
-- No LLM API keys, private keys, or bot secrets belong in these tables.

create table if not exists public.agent_bridge_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  agent_id text not null,
  role text not null check (role in ('oracle', 'momentum_resolver', 'scalping_resolver', 'evaluator', 'executor')),
  type text not null check (type in ('market_snapshot', 'resolver_output', 'evaluation', 'execution_intent')),
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  source text not null default 'pm2-bot',
  dry_run boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists agent_bridge_events_session_created_idx
  on public.agent_bridge_events (session_id, created_at desc);

create index if not exists agent_bridge_events_role_created_idx
  on public.agent_bridge_events (role, created_at desc);

create table if not exists public.agent_bridge_receipts (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  receipt_type text not null check (receipt_type in ('x402_arc_native', 'x402_circle_gateway', 'dry_run')),
  payment_id text,
  transaction text,
  payload_hash text,
  created_at timestamptz not null default now()
);

create index if not exists agent_bridge_receipts_session_created_idx
  on public.agent_bridge_receipts (session_id, created_at desc);
