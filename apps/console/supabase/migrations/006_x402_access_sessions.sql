-- x402 access-session guard
-- Prevents accidental double-charge for the same payer/resource before settlement.

create table if not exists public.x402_access_sessions (
  id uuid primary key default gen_random_uuid(),
  payer text not null,
  resource text not null,
  rail text not null check (rail in ('arc-native', 'circle-gateway')),
  payment_id text,
  tx_hash text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_x402_access_sessions_lookup
  on public.x402_access_sessions (payer, resource, expires_at desc);

create or replace function public.x402_claim_access_session(
  p_payer text,
  p_resource text,
  p_rail text,
  p_ttl_seconds integer default 3600
)
returns table (
  ok boolean,
  reason text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.x402_access_sessions%rowtype;
  v_expires_at timestamptz := now() + make_interval(secs => p_ttl_seconds);
begin
  select * into v_existing
  from public.x402_access_sessions
  where lower(payer) = lower(p_payer)
    and resource = p_resource
    and rail = p_rail
    and expires_at > now()
  order by expires_at desc
  limit 1;

  if found then
    return query select false, 'active_session'::text, v_existing.expires_at;
    return;
  end if;

  insert into public.x402_access_sessions (payer, resource, rail, expires_at)
  values (p_payer, p_resource, p_rail, v_expires_at);

  return query select true, null::text, v_expires_at;
end;
$$;

create or replace function public.x402_complete_access_session(
  p_payer text,
  p_resource text,
  p_rail text,
  p_payment_id text,
  p_tx_hash text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.x402_access_sessions
  set payment_id = p_payment_id,
      tx_hash = p_tx_hash,
      updated_at = now()
  where lower(payer) = lower(p_payer)
    and resource = p_resource
    and rail = p_rail
    and expires_at > now();
end;
$$;

create or replace function public.x402_release_access_session(
  p_payer text,
  p_resource text,
  p_rail text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.x402_access_sessions
  set expires_at = now(),
      updated_at = now()
  where lower(payer) = lower(p_payer)
    and resource = p_resource
    and rail = p_rail
    and expires_at > now();
end;
$$;
