-- ArcLayer Agent Manifest V1 — off-chain manifest cache.
-- On-chain metadataURI = arclayer://manifest/<agentId> points here.
-- Chain remains source of truth for identity (controller). Supabase stores discovery metadata only.

create table if not exists agent_manifests (
  agent_id        text primary key,
  controller      text,                 -- lowercased EOA address (signer == on-chain controller)
  manifest        jsonb        not null, -- AgentManifestV1 JSON
  manifest_hash   text         not null, -- 0x-prefixed keccak256 of canonical JSON
  signature       text,                  -- EIP-191 personal_sign over message (Phase 1)
  signer          text,                  -- recovered signer address, lowercased
  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now()
);

create index if not exists agent_manifests_controller_idx on agent_manifests (controller);
create index if not exists agent_manifests_updated_at_idx on agent_manifests (updated_at desc);

-- RLS: server-only via service_role. No client-side access.
alter table agent_manifests enable row level security;
-- No policies = service_role bypass only.

-- Auto-touch updated_at on row update
create or replace function agent_manifests_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists agent_manifests_touch on agent_manifests;
create trigger agent_manifests_touch
  before update on agent_manifests
  for each row
  execute function agent_manifests_touch_updated_at();
