-- ArcLayer x402 Circle Gateway Payment Store
-- Persistent replay protection for Gateway payments. Survives Vercel cold starts.
--
-- Lifecycle:
--   verify  → record `status='verified'`
--   settle  → upsert `status='settled' | 'accepted_pending_settlement'`
--   protected resource consume → atomic `consumed_at = now()` (replay-safe)

create table if not exists public.x402_gateway_payments (
  id uuid primary key default gen_random_uuid(),

  -- Deterministic sha256 of {paymentPayload, paymentRequirements} stable JSON.
  -- Mirrors `deriveGatewayPaymentId()` in apps/console/src/lib/x402/gateway/payment-store.ts.
  payment_id text not null unique,

  -- Lifecycle status. Mapped 1:1 to Circle SDK SettleResponse outcomes.
  status text not null default 'verified',

  -- x402 v2 fields captured from the verify/settle exchange.
  payer text,
  pay_to text,
  amount text,
  asset text,
  network text,
  resource text,

  -- Circle settlement reference (UUID, NOT an EVM tx hash for the Gateway path).
  -- See references/x402-dual-mode-arc-native-and-gateway.md item 9.
  gateway_settlement_id text,

  -- Verbatim Circle SDK responses for forensic/audit replay.
  verify_payload jsonb not null default '{}'::jsonb,
  settle_payload jsonb not null default '{}'::jsonb,

  -- Timing markers used by gatewayEvidenceSummary() and the protected route.
  verified_at timestamptz,
  settled_at timestamptz,
  consumed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint x402_gateway_payments_status_check check (
    status in (
      'verified',
      'accepted_pending_settlement',
      'settled',
      'consumed',
      'failed'
    )
  )
);

create index if not exists idx_x402_gateway_payments_status
  on public.x402_gateway_payments (status);
create index if not exists idx_x402_gateway_payments_payer
  on public.x402_gateway_payments (payer)
  where payer is not null;
create index if not exists idx_x402_gateway_payments_settlement
  on public.x402_gateway_payments (gateway_settlement_id)
  where gateway_settlement_id is not null;
create index if not exists idx_x402_gateway_payments_created
  on public.x402_gateway_payments (created_at desc);

drop trigger if exists trg_x402_gateway_payments_updated_at on public.x402_gateway_payments;
create trigger trg_x402_gateway_payments_updated_at
before update on public.x402_gateway_payments
for each row execute function public.set_updated_at();

-- Atomic consume RPC: marks `consumed_at` exactly once.
-- Returns ok=false reason='replayed' if consumed_at is already set.
-- Returns ok=false reason='missing' if payment_id not found.
create or replace function public.x402_gateway_consume_payment(
  p_payment_id text
)
returns table (
  ok boolean,
  reason text,
  status text,
  consumed_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.x402_gateway_payments%rowtype;
begin
  -- Lock row to prevent concurrent consumes from racing.
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

  update public.x402_gateway_payments
  set consumed_at = now(),
      status = 'consumed'
  where payment_id = p_payment_id;

  return query select true, null::text, 'consumed'::text, now();
end;
$$;

alter table public.x402_gateway_payments enable row level security;

drop policy if exists "x402_gateway_payments_deny_anon" on public.x402_gateway_payments;
create policy "x402_gateway_payments_deny_anon"
  on public.x402_gateway_payments
  for all to anon, authenticated
  using (false)
  with check (false);

grant all on public.x402_gateway_payments to service_role;
grant execute on function public.x402_gateway_consume_payment to service_role;
