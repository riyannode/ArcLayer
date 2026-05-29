-- Atomic faucet claim reservation — prevents double-claim race conditions.
-- Run AFTER the base faucet_claims table migration.

create or replace function faucet_reserve_claim(
  p_wallet_address text,
  p_ip_hash text,
  p_amount_usdc numeric,
  p_max_daily integer
)
returns table (
  ok boolean,
  reason text,
  claim_id uuid,
  retry_after_seconds integer
)
language plpgsql
security definer
as $$
declare
  v_since timestamptz := now() - interval '24 hours';
  v_claim_id uuid;
  v_wallet_count integer;
  v_ip_count integer;
  v_global_count integer;
begin
  -- Auto-expire stale pending claims (>15 min old)
  update faucet_claims
  set status = 'failed'
  where status = 'pending'
    and created_at < now() - interval '15 minutes';

  -- Advisory locks per wallet + IP to serialize concurrent claims
  perform pg_advisory_xact_lock(hashtext('faucet:wallet:' || lower(p_wallet_address)));
  perform pg_advisory_xact_lock(hashtext('faucet:ip:' || p_ip_hash));
  perform pg_advisory_xact_lock(hashtext('faucet:global:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD')));

  -- Rate limit: wallet (1 / 24h)
  select count(*) into v_wallet_count
  from faucet_claims
  where lower(wallet_address) = lower(p_wallet_address)
    and created_at >= v_since
    and status in ('pending', 'sent');

  if v_wallet_count > 0 then
    return query select false, 'rate_limited_wallet', null::uuid, 86400;
    return;
  end if;

  -- Rate limit: IP (1 / 24h)
  select count(*) into v_ip_count
  from faucet_claims
  where ip_hash = p_ip_hash
    and created_at >= v_since
    and status in ('pending', 'sent');

  if v_ip_count >= 1 then
    return query select false, 'rate_limited_ip', null::uuid, 86400;
    return;
  end if;

  -- Rate limit: global (N / 24h)
  select count(*) into v_global_count
  from faucet_claims
  where created_at >= v_since
    and status in ('pending', 'sent');

  if v_global_count >= p_max_daily then
    return query select false, 'rate_limited_global', null::uuid, 86400;
    return;
  end if;

  -- Reserve claim as pending
  insert into faucet_claims (
    wallet_address,
    ip_hash,
    amount_usdc,
    status
  ) values (
    p_wallet_address,
    p_ip_hash,
    p_amount_usdc,
    'pending'
  )
  returning id into v_claim_id;

  return query select true, 'reserved', v_claim_id, 0;
end;
$$;
