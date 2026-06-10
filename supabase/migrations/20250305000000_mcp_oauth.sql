-- ArcLayer MCP OAuth schema
-- Adds OAuth client registration, authorization code, access token,
-- refresh token, and MCP OAuth connection tables.
--
-- Security model:
-- - Raw authorization codes are never stored.
-- - Raw access tokens are never stored.
-- - Raw refresh tokens are never stored.
-- - Store SHA-256/token hashes only.
-- - Server-side code must use service-role access.
-- - RLS is enabled with no public policies.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.oauth_clients (
  id uuid primary key default gen_random_uuid(), client_id text not null unique, client_name text not null,
  client_type text not null default 'mcp_client', redirect_uris jsonb not null default '[]'::jsonb,
  grant_types text[] not null default array['authorization_code', 'refresh_token']::text[],
  response_types text[] not null default array['code']::text[], token_endpoint_auth_method text not null default 'none',
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), revoked_at timestamptz,
  constraint oauth_clients_client_id_not_empty check (length(trim(client_id)) > 0),
  constraint oauth_clients_client_name_not_empty check (length(trim(client_name)) > 0),
  constraint oauth_clients_redirect_uris_array check (jsonb_typeof(redirect_uris) = 'array'),
  constraint oauth_clients_token_auth_method_valid check (token_endpoint_auth_method in ('none', 'client_secret_basic', 'client_secret_post'))
);
create table if not exists public.mcp_oauth_connections (
  id uuid primary key default gen_random_uuid(), owner_wallet text not null,
  client_id text not null references public.oauth_clients(client_id) on delete cascade, client_name text not null,
  client_type text not null default 'codex', selected_agent_id text, scopes text[] not null default '{}'::text[],
  policy_json jsonb not null default '{}'::jsonb, status text not null default 'active',
  created_at timestamptz not null default now(), revoked_at timestamptz,
  constraint mcp_oauth_connections_owner_wallet_not_empty check (length(trim(owner_wallet)) > 0),
  constraint mcp_oauth_connections_status_valid check (status in ('active', 'revoked', 'expired')),
  constraint mcp_oauth_connections_policy_object check (jsonb_typeof(policy_json) = 'object')
);
create table if not exists public.oauth_authorization_codes (
  id uuid primary key default gen_random_uuid(), code_hash text not null unique,
  client_id text not null references public.oauth_clients(client_id) on delete cascade, owner_wallet text not null,
  redirect_uri text not null, resource text not null, scopes text[] not null default '{}'::text[],
  code_challenge text not null, code_challenge_method text not null default 'S256', expires_at timestamptz not null,
  consumed_at timestamptz, created_at timestamptz not null default now(),
  constraint oauth_authorization_codes_code_hash_not_empty check (length(trim(code_hash)) > 0),
  constraint oauth_authorization_codes_owner_wallet_not_empty check (length(trim(owner_wallet)) > 0),
  constraint oauth_authorization_codes_redirect_uri_not_empty check (length(trim(redirect_uri)) > 0),
  constraint oauth_authorization_codes_resource_not_empty check (length(trim(resource)) > 0),
  constraint oauth_authorization_codes_pkce_s256_only check (code_challenge_method = 'S256'),
  constraint oauth_authorization_codes_expiry_after_created check (expires_at > created_at)
);
create table if not exists public.oauth_access_tokens (
  id uuid primary key default gen_random_uuid(), token_hash text not null unique,
  client_id text not null references public.oauth_clients(client_id) on delete cascade, owner_wallet text not null,
  connection_id uuid not null references public.mcp_oauth_connections(id) on delete cascade, resource text not null,
  scopes text[] not null default '{}'::text[], expires_at timestamptz not null, revoked_at timestamptz,
  last_used_at timestamptz, created_at timestamptz not null default now(),
  constraint oauth_access_tokens_token_hash_not_empty check (length(trim(token_hash)) > 0),
  constraint oauth_access_tokens_owner_wallet_not_empty check (length(trim(owner_wallet)) > 0),
  constraint oauth_access_tokens_resource_not_empty check (length(trim(resource)) > 0),
  constraint oauth_access_tokens_expiry_after_created check (expires_at > created_at)
);
create table if not exists public.oauth_refresh_tokens (
  id uuid primary key default gen_random_uuid(), token_hash text not null unique,
  client_id text not null references public.oauth_clients(client_id) on delete cascade, owner_wallet text not null,
  connection_id uuid not null references public.mcp_oauth_connections(id) on delete cascade,
  scopes text[] not null default '{}'::text[], expires_at timestamptz not null, revoked_at timestamptz,
  rotated_at timestamptz, created_at timestamptz not null default now(),
  constraint oauth_refresh_tokens_token_hash_not_empty check (length(trim(token_hash)) > 0),
  constraint oauth_refresh_tokens_owner_wallet_not_empty check (length(trim(owner_wallet)) > 0),
  constraint oauth_refresh_tokens_expiry_after_created check (expires_at > created_at)
);
create index if not exists idx_oauth_clients_client_id on public.oauth_clients(client_id);
create index if not exists idx_oauth_clients_revoked_at on public.oauth_clients(revoked_at);
create index if not exists idx_mcp_oauth_connections_owner_wallet_lower on public.mcp_oauth_connections(lower(owner_wallet));
create index if not exists idx_mcp_oauth_connections_client_id on public.mcp_oauth_connections(client_id);
create index if not exists idx_mcp_oauth_connections_status on public.mcp_oauth_connections(status);
create index if not exists idx_oauth_authorization_codes_code_hash on public.oauth_authorization_codes(code_hash);
create index if not exists idx_oauth_authorization_codes_client_id on public.oauth_authorization_codes(client_id);
create index if not exists idx_oauth_authorization_codes_owner_wallet_lower on public.oauth_authorization_codes(lower(owner_wallet));
create index if not exists idx_oauth_authorization_codes_expires_at on public.oauth_authorization_codes(expires_at);
create index if not exists idx_oauth_access_tokens_token_hash on public.oauth_access_tokens(token_hash);
create index if not exists idx_oauth_access_tokens_client_id on public.oauth_access_tokens(client_id);
create index if not exists idx_oauth_access_tokens_connection_id on public.oauth_access_tokens(connection_id);
create index if not exists idx_oauth_access_tokens_owner_wallet_lower on public.oauth_access_tokens(lower(owner_wallet));
create index if not exists idx_oauth_access_tokens_expires_at on public.oauth_access_tokens(expires_at);
create index if not exists idx_oauth_refresh_tokens_token_hash on public.oauth_refresh_tokens(token_hash);
create index if not exists idx_oauth_refresh_tokens_client_id on public.oauth_refresh_tokens(client_id);
create index if not exists idx_oauth_refresh_tokens_connection_id on public.oauth_refresh_tokens(connection_id);
create index if not exists idx_oauth_refresh_tokens_owner_wallet_lower on public.oauth_refresh_tokens(lower(owner_wallet));
create index if not exists idx_oauth_refresh_tokens_expires_at on public.oauth_refresh_tokens(expires_at);
alter table public.oauth_clients enable row level security;
alter table public.mcp_oauth_connections enable row level security;
alter table public.oauth_authorization_codes enable row level security;
alter table public.oauth_access_tokens enable row level security;
alter table public.oauth_refresh_tokens enable row level security;
comment on table public.oauth_clients is 'Registered OAuth clients for ArcLayer MCP remote clients such as Codex or Claude.';
comment on table public.mcp_oauth_connections is 'Wallet-scoped MCP OAuth connections. Maps client, wallet, scopes, and policy.';
comment on table public.oauth_authorization_codes is 'Short-lived hashed OAuth authorization codes. Raw codes are returned once and never stored.';
comment on table public.oauth_access_tokens is 'Hashed OAuth access tokens for ArcLayer MCP. Raw tokens are returned once and never stored.';
comment on table public.oauth_refresh_tokens is 'Hashed OAuth refresh tokens for ArcLayer MCP. Raw tokens are returned once and never stored.';

-- Allow existing Agent Bundle registration intents to be owned by either a
-- legacy MCP session or an OAuth connection without changing mint/finalize UX.
alter table public.mcp_registration_intents
  alter column mcp_session_id drop not null;

alter table public.mcp_registration_intents
  add column if not exists oauth_connection_id uuid references public.mcp_oauth_connections(id) on delete cascade;

create index if not exists idx_mcp_registration_intents_oauth_connection_id
  on public.mcp_registration_intents(oauth_connection_id);

alter table public.mcp_registration_intents
  drop constraint if exists mcp_registration_intents_auth_source;

alter table public.mcp_registration_intents
  add constraint mcp_registration_intents_auth_source
  check ((mcp_session_id is not null) <> (oauth_connection_id is not null));
