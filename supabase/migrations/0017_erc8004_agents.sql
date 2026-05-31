-- 0017: erc8004_agents — sync ERC-8004 on-chain agent registrations to Supabase
-- Used by indexer syncProjectionStore() to upsert agent data from local SQLite.

create table if not exists erc8004_agents (
  token_id text primary key,
  agent_id text not null,
  owner text not null,
  controller text not null,
  metadata_uri text not null,
  metadata_json jsonb,
  source text not null default 'erc8004_identity_registry',
  chain_id text not null,
  registry_address text not null,
  tx_hash text not null,
  block_number text not null,
  minted_at text,
  updated_at timestamptz not null default now()
);
