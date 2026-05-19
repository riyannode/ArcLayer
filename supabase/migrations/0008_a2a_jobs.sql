-- ArcLayer A2A persistent job store.
-- Replaces the Phase 4/8 in-memory Map so jobs survive Vercel cold starts/redeploys.

create table if not exists a2a_jobs (
  id            text primary key,
  title         text not null,
  description   text not null,
  category      text,
  role_id       text,
  budget        text not null default '0.00',
  requester     text not null default 'anonymous',
  agent_id      text,
  claimed_by    text,
  status        text not null default 'open' check (status in ('open', 'claimed', 'submitted')),
  input         jsonb,
  output        jsonb,
  proof         jsonb,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  submitted_at  timestamptz
);

create index if not exists a2a_jobs_status_idx on a2a_jobs (status, created_at desc);
create index if not exists a2a_jobs_agent_id_idx on a2a_jobs (agent_id, created_at desc);
create index if not exists a2a_jobs_claimed_by_idx on a2a_jobs (claimed_by, created_at desc);
create index if not exists a2a_jobs_category_idx on a2a_jobs (category, created_at desc);
create index if not exists a2a_jobs_role_id_idx on a2a_jobs (role_id, created_at desc);

-- RLS: server-only via service_role. No client-side access.
alter table a2a_jobs enable row level security;
-- No policies = service_role bypass only.
