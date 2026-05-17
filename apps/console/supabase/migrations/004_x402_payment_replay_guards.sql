-- ────────────────────────────────────────────────────────────────────────────
-- 004_x402_payment_replay_guards.sql
--
-- Hardens both x402 rails:
-- 1) Arc Native: consume-once guard for protected resources.
-- 2) Circle Gateway: pre-settle claim lock before calling Circle client.settle().
-- 3) Circle Gateway: consume preserves settlement status; only consumed_at changes.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.x402_native_payments
  add column if not exists consumed_at timestamptz;

create index if not exists x402_native_payments_consumed_idx
  on public.x402_native_payments (consumed_at)
  where consumed_at is not null;

create or replace function public.x402_native_consume_payment(
  p_payment_id text
)
returns table (
  ok boolean,
  reason text,
  status text,
  consumed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.x402_native_payments%rowtype;
  v_consumed_at timestamptz;
begin
  select * into v_row
  from public.x402_native_payments
  where payment_id = p_payment_id
  for update;

  if not found then
    return query select false, 'missing'::text, null::text, null::timestamptz;
    return;
  end if;

  if v_row.status <> 'settled' then
    return query select false, 'not_settled'::text, v_row.status, v_row.consumed_at;
    return;
  end if;

  if v_row.consumed_at is not null then
    return query select false, 'replayed'::text, v_row.status, v_row.consumed_at;
    return;
  end if;

  v_consumed_at := now();

  update public.x402_native_payments
     set consumed_at = v_consumed_at
   where payment_id = p_payment_id;

  return query select true, null::text, v_row.status, v_consumed_at;
end;
$$;

grant execute on function public.x402_native_consume_payment to service_role;

alter table public.x402_gateway_payments
  add column if not exists settlement_claimed_at timestamptz;

create index if not exists idx_x402_gateway_payments_settlement_claimed
  on public.x402_gateway_payments (settlement_claimed_at)
  where settlement_claimed_at is not null;

-- Claim lock for Circle Gateway settle. Exactly one caller gets ok=true and may
-- call Circle client.settle(). Concurrent callers see in_flight. Settled/consumed
-- rows return terminal state without calling Circle again. Failed rows are reset
-- for retry.
create or replace function public.x402_gateway_claim_settlement(
  p_payment_id text,
  p_payer text default null,
  p_pay_to text default null,
  p_amount text default null,
  p_asset text default null,
  p_network text default null,
  p_resource text default null,
  p_verify_payload jsonb default '{}'::jsonb
)
returns table (
  ok boolean,
  reason text,
  status text,
  gateway_settlement_id text,
  settlement_claimed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.x402_gateway_payments%rowtype;
  v_claimed_at timestamptz;
begin
  select * into v_row
  from public.x402_gateway_payments
  where payment_id = p_payment_id
  for update;

  if not found then
    v_claimed_at := now();
    insert into public.x402_gateway_payments (
      payment_id,
      status,
      payer,
      pay_to,
      amount,
      asset,
      network,
      resource,
      verify_payload,
      verified_at,
      settlement_claimed_at
    ) values (
      p_payment_id,
      'verified',
      p_payer,
      p_pay_to,
      p_amount,
      p_asset,
      p_network,
      p_resource,
      coalesce(p_verify_payload, '{}'::jsonb),
      v_claimed_at,
      v_claimed_at
    );

    return query select true, null::text, 'verified'::text, null::text, v_claimed_at;
    return;
  end if;

  if v_row.status in ('settled', 'accepted_pending_settlement') then
    return query select false, 'already_settled'::text, v_row.status, v_row.gateway_settlement_id, v_row.settlement_claimed_at;
    return;
  end if;

  if v_row.consumed_at is not null or v_row.status = 'consumed' then
    return query select false, 'consumed'::text, v_row.status, v_row.gateway_settlement_id, v_row.settlement_claimed_at;
    return;
  end if;

  if v_row.settlement_claimed_at is not null and v_row.status <> 'failed' then
    return query select false, 'in_flight'::text, v_row.status, v_row.gateway_settlement_id, v_row.settlement_claimed_at;
    return;
  end if;

  v_claimed_at := now();

  update public.x402_gateway_payments
     set status = 'verified',
         payer = coalesce(p_payer, payer),
         pay_to = coalesce(p_pay_to, pay_to),
         amount = coalesce(p_amount, amount),
         asset = coalesce(p_asset, asset),
         network = coalesce(p_network, network),
         resource = coalesce(p_resource, resource),
         verify_payload = case
           when p_verify_payload is null or p_verify_payload = '{}'::jsonb then verify_payload
           else p_verify_payload
         end,
         verified_at = coalesce(verified_at, v_claimed_at),
         settlement_claimed_at = v_claimed_at
   where payment_id = p_payment_id;

  return query select true, null::text, 'verified'::text, v_row.gateway_settlement_id, v_claimed_at;
end;
$$;

grant execute on function public.x402_gateway_claim_settlement to service_role;

-- Status-preserving consume: never overwrites settled/accepted_pending_settlement.
-- `consumed_at` is the replay guard; `status` remains the settlement audit state.
create or replace function public.x402_gateway_consume_payment(
  p_payment_id text
)
returns table (
  ok boolean,
  reason text,
  status text,
  consumed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.x402_gateway_payments%rowtype;
  v_consumed_at timestamptz;
begin
  select * into v_row
  from public.x402_gateway_payments
  where payment_id = p_payment_id
  for update;

  if not found then
    return query select false, 'missing'::text, null::text, null::timestamptz;
    return;
  end if;

  if v_row.consumed_at is not null then
    return query select false, 'replayed'::text, v_row.status, v_row.consumed_at;
    return;
  end if;

  v_consumed_at := now();

  update public.x402_gateway_payments
     set consumed_at = v_consumed_at
   where payment_id = p_payment_id;

  return query select true, null::text, v_row.status, v_consumed_at;
end;
$$;

grant execute on function public.x402_gateway_consume_payment to service_role;
