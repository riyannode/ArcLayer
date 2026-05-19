-- ArcLayer A2A API key store.
-- Phase 11: External agents authenticate to /api/a2a/jobs/{claim,submit}
-- with bearer API keys. Keys are stored as SHA-256 hashes (never plaintext).

create table if not exists a2a_api_keys (
  id            uuid primary key default gen_random_uuid(),
  agent_id      text not null,
  key_hash      text not null unique,
  key_prefix    text not null,            -- first 8 chars, for UX (e.g. "ak_abc12...")
  label         text,
  scopes        text[] not null default array['jobs:claim','jobs:submit'],
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_by    text                       -- controller eoa that minted the key
);

create index if not exists idx_a2a_api_keys_agent on a2a_api_keys (agent_id);
create index if not exists idx_a2a_api_keys_active on a2a_api_keys (agent_id) where revoked_at is null;

alter table a2a_api_keys enable row level security;

-- Service role only; no public reads/writes.
drop policy if exists a2a_api_keys_service_role on a2a_api_keys;
create policy a2a_api_keys_service_role
  on a2a_api_keys
  for all
  to service_role
  using (true)
  with check (true);
