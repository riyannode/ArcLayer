create table if not exists agent_live_events (
  id bigint generated always as identity primary key,
  agent_id text not null,
  agent_name text,
  event_type text not null,
  title text,
  summary text,
  tx_hash text,
  amount_atomic text,
  currency text,
  decision text,
  confidence numeric,
  trace jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_live_events_agent_id_created_at
  on agent_live_events(agent_id, created_at desc);

create index if not exists idx_agent_live_events_event_type_created_at
  on agent_live_events(event_type, created_at desc);

create table if not exists agent_presence (
  agent_id text primary key,
  agent_name text,
  status text not null default 'offline',
  last_heartbeat_at timestamptz not null default now(),
  last_event_type text,
  last_event_summary text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_agent_presence_updated_at
  on agent_presence(updated_at desc);
