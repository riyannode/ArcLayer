-- ────────────────────────────────────────────────────────────────────────────
-- 003_x402_native_payments.sql
--
-- Arc Native (self-hosted EIP-3009) idempotency ledger.
--
-- Why this table exists:
--   On-chain `authorizationState(from, nonce)` is the ground-truth replay
--   primitive, but it does not give us the settlement tx hash, payer, or amount
--   without a log scan. We need a fast local lookup so /api/x402/settle can
--   return `alreadySettled: true` with the previous tx hash on the second click,
--   instead of submitting `transferWithAuthorization` twice (which would revert
--   on-chain with `authorization_used` and look like a payment failure).
--
-- Design:
--   PK = sha256("native:x402:" || network || ":" || asset || ":" || from || ":" || nonce)
--   Status flow: pending → settled | failed
--   Atomic claim via INSERT ... ON CONFLICT DO NOTHING (handled in app code,
--   no RPC needed because there is no consume-step like Gateway has).
--
-- IMPORTANT: This table is rail-isolated. It MUST NEVER reference Circle
-- Gateway payment ids and MUST NEVER be written from the Gateway code path.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.x402_native_payments (
  payment_id        text primary key,
  network           text not null,
  asset             text not null,
  payer             text not null,
  pay_to            text,
  amount            text,
  nonce             text not null,
  tx_hash           text,
  status            text not null check (status in ('pending', 'settled', 'failed')),
  error_reason      text,
  error_message     text,
  raw               jsonb,
  created_at        timestamptz not null default now(),
  settled_at        timestamptz,
  updated_at        timestamptz not null default now()
);

create index if not exists x402_native_payments_payer_idx
  on public.x402_native_payments (payer);

create index if not exists x402_native_payments_status_idx
  on public.x402_native_payments (status);

create index if not exists x402_native_payments_created_idx
  on public.x402_native_payments (created_at desc);

-- Auto-bump updated_at
create or replace function public.x402_native_payments_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists x402_native_payments_touch_updated_at on public.x402_native_payments;
create trigger x402_native_payments_touch_updated_at
before update on public.x402_native_payments
for each row execute function public.x402_native_payments_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- Atomic claim function.
-- Tries to INSERT a fresh `pending` row. On conflict (row exists), returns the
-- existing row WITHOUT modifying it. Caller decides what to do based on status.
--
-- Returns:
--   ok=true  + status='pending'  → caller acquired the lock, may submit tx
--   ok=false + status='settled'  → already settled, return existing tx_hash
--   ok=false + status='pending'  → another worker is currently submitting
--   ok=false + status='failed'   → previous attempt failed, caller may retry
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.x402_native_claim_payment(
  p_payment_id text,
  p_network    text,
  p_asset      text,
  p_payer      text,
  p_pay_to     text,
  p_amount     text,
  p_nonce      text
)
returns table (
  ok        boolean,
  status    text,
  tx_hash   text,
  payer     text,
  amount    text,
  settled_at timestamptz
)
language plpgsql
security definer
as $$
declare
  v_inserted boolean := false;
  v_reclaimed boolean := false;
begin
  -- Try fresh insert first
  insert into public.x402_native_payments (
    payment_id, network, asset, payer, pay_to, amount, nonce, status
  ) values (
    p_payment_id, p_network, p_asset, p_payer, p_pay_to, p_amount, p_nonce, 'pending'
  )
  on conflict (payment_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted then
    return query
      select true,
             'pending'::text,
             null::text,
             p_payer,
             p_amount,
             null::timestamptz;
    return;
  end if;

  -- Row exists. If previous attempt FAILED, atomically reset to pending and
  -- return ok=true so the caller can retry. This is safe because failed rows
  -- have no on-chain effect (settle never happened) and the same payer+nonce
  -- still uniquely identifies the same authorization.
  update public.x402_native_payments np
     set status = 'pending',
         error_reason = null,
         error_message = null,
         updated_at = now()
   where np.payment_id = p_payment_id
     and np.status = 'failed';

  get diagnostics v_reclaimed = row_count;

  if v_reclaimed then
    return query
      select true,
             'pending'::text,
             null::text,
             p_payer,
             p_amount,
             null::timestamptz;
    return;
  end if;

  -- Either 'pending' (in-flight) or 'settled' (already done) — no claim, return
  -- existing row so caller can decide.
  return query
    select false,
           p.status,
           p.tx_hash,
           p.payer,
           p.amount,
           p.settled_at
    from public.x402_native_payments p
    where p.payment_id = p_payment_id;
end;
$$;

grant all on public.x402_native_payments to service_role;
grant execute on function public.x402_native_claim_payment to service_role;
