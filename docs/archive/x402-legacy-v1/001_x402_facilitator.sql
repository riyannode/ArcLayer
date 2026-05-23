-- ArcLayer x402 Facilitator V1 schema
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.x402_requirements (
  id uuid primary key default gen_random_uuid(),
  requirement_id text not null unique,
  protocol text not null default 'x402',
  scheme text not null default 'arc-escrow',
  network text not null default 'arc-testnet',
  chain_id integer not null,
  resource text not null,
  resource_method text not null default 'POST',
  description text,
  mime_type text,
  pay_to text not null,
  asset text not null,
  amount_required numeric(78, 0) not null,
  amount_display text,
  currency text not null default 'USDC',
  max_timeout_seconds integer not null default 300,
  expires_at timestamptz not null,
  nonce text not null unique,
  job_id text,
  agent_id text,
  route_pattern text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint x402_requirements_status_check check (status in ('active','expired','fulfilled','cancelled')),
  constraint x402_requirements_chain_check check (chain_id = 5042002),
  constraint x402_requirements_amount_positive check (amount_required > 0),
  constraint x402_requirements_expires_futureish check (expires_at > created_at)
);

create index if not exists idx_x402_requirements_resource on public.x402_requirements (resource);
create index if not exists idx_x402_requirements_job_id on public.x402_requirements (job_id) where job_id is not null;
create index if not exists idx_x402_requirements_status_expires on public.x402_requirements (status, expires_at);

drop trigger if exists trg_x402_requirements_updated_at on public.x402_requirements;
create trigger trg_x402_requirements_updated_at
before update on public.x402_requirements
for each row execute function public.set_updated_at();

create table if not exists public.x402_payments (
  id uuid primary key default gen_random_uuid(),
  payment_id text not null unique,
  requirement_id text not null,
  tx_hash text not null unique,
  chain_id integer not null,
  scheme text not null default 'arc-escrow',
  network text not null default 'arc-testnet',
  payer text,
  pay_to text not null,
  asset text not null,
  amount numeric(78, 0) not null,
  job_id text not null,
  resource text not null,
  block_number bigint,
  block_hash text,
  log_index integer,
  event_name text not null default 'JobFunded',
  verification_payload jsonb not null default '{}'::jsonb,
  settlement_payload jsonb not null default '{}'::jsonb,
  status text not null default 'verified',
  verified_at timestamptz,
  settled_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz,
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint x402_payments_requirement_fk foreign key (requirement_id) references public.x402_requirements (requirement_id) on update cascade on delete restrict,
  constraint x402_payments_status_check check (status in ('verified','settled','consumed','failed','expired')),
  constraint x402_payments_chain_check check (chain_id = 5042002),
  constraint x402_payments_amount_positive check (amount > 0)
);

create unique index if not exists uq_x402_payments_event_log on public.x402_payments (tx_hash, log_index) where log_index is not null;
create index if not exists idx_x402_payments_requirement on public.x402_payments (requirement_id);
create index if not exists idx_x402_payments_job_id on public.x402_payments (job_id);
create index if not exists idx_x402_payments_status on public.x402_payments (status);

drop trigger if exists trg_x402_payments_updated_at on public.x402_payments;
create trigger trg_x402_payments_updated_at
before update on public.x402_payments
for each row execute function public.set_updated_at();

create table if not exists public.x402_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_id text not null unique,
  payment_id text,
  requirement_id text,
  tx_hash text,
  operation text not null,
  status text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  duration_ms integer,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint x402_payment_attempts_payment_fk foreign key (payment_id) references public.x402_payments (payment_id) on update cascade on delete set null,
  constraint x402_payment_attempts_requirement_fk foreign key (requirement_id) references public.x402_requirements (requirement_id) on update cascade on delete set null,
  constraint x402_payment_attempts_operation_check check (operation in ('verify','settle','consume','issue_requirement')),
  constraint x402_payment_attempts_status_check check (status in ('started','succeeded','failed','replayed','rejected'))
);

create index if not exists idx_x402_payment_attempts_payment on public.x402_payment_attempts (payment_id) where payment_id is not null;
create index if not exists idx_x402_payment_attempts_tx_hash on public.x402_payment_attempts (tx_hash) where tx_hash is not null;
create index if not exists idx_x402_payment_attempts_created_at on public.x402_payment_attempts (created_at desc);

create table if not exists public.x402_consumptions (
  id uuid primary key default gen_random_uuid(),
  consumption_id text not null unique,
  payment_id text not null,
  tx_hash text not null,
  requirement_id text not null,
  resource text not null,
  resource_method text not null default 'POST',
  consumer_key text not null,
  status text not null default 'consumed',
  consumed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint x402_consumptions_payment_fk foreign key (payment_id) references public.x402_payments (payment_id) on update cascade on delete restrict,
  constraint x402_consumptions_requirement_fk foreign key (requirement_id) references public.x402_requirements (requirement_id) on update cascade on delete restrict,
  constraint x402_consumptions_status_check check (status in ('consumed','released','failed'))
);

create unique index if not exists uq_x402_consumptions_payment on public.x402_consumptions (payment_id);
create unique index if not exists uq_x402_consumptions_tx_hash on public.x402_consumptions (tx_hash);
create unique index if not exists uq_x402_consumptions_consumer_key on public.x402_consumptions (consumer_key);

drop trigger if exists trg_x402_consumptions_updated_at on public.x402_consumptions;
create trigger trg_x402_consumptions_updated_at
before update on public.x402_consumptions
for each row execute function public.set_updated_at();

create table if not exists public.x402_response_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  payment_id text not null,
  consumption_id text not null,
  requirement_id text not null,
  resource text not null,
  status_code integer not null,
  response_headers jsonb not null default '{}'::jsonb,
  response_body jsonb,
  body_text text,
  content_type text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint x402_response_cache_payment_fk foreign key (payment_id) references public.x402_payments (payment_id) on update cascade on delete restrict,
  constraint x402_response_cache_consumption_fk foreign key (consumption_id) references public.x402_consumptions (consumption_id) on update cascade on delete restrict,
  constraint x402_response_cache_status_code_check check (status_code between 100 and 599)
);

create index if not exists idx_x402_response_cache_payment on public.x402_response_cache (payment_id);
create index if not exists idx_x402_response_cache_expires on public.x402_response_cache (expires_at);

drop trigger if exists trg_x402_response_cache_updated_at on public.x402_response_cache;
create trigger trg_x402_response_cache_updated_at
before update on public.x402_response_cache
for each row execute function public.set_updated_at();

create or replace function public.x402_consume_payment(
  p_payment_id text,
  p_tx_hash text,
  p_requirement_id text,
  p_resource text,
  p_resource_method text,
  p_consumer_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  ok boolean,
  code text,
  consumption_id text,
  existing_payment_id text,
  message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_payment public.x402_payments%rowtype;
  v_existing public.x402_consumptions%rowtype;
  v_consumption_id text;
begin
  select * into v_payment from public.x402_payments where payment_id = p_payment_id for update;
  if not found then
    return query select false, 'PAYMENT_NOT_FOUND', null::text, null::text, 'Payment not found';
    return;
  end if;
  if v_payment.tx_hash <> p_tx_hash then
    return query select false, 'TX_HASH_MISMATCH', null::text, v_payment.payment_id, 'txHash mismatch';
    return;
  end if;
  if v_payment.requirement_id <> p_requirement_id then
    return query select false, 'REQUIREMENT_MISMATCH', null::text, v_payment.payment_id, 'Requirement mismatch';
    return;
  end if;
  if v_payment.resource <> p_resource then
    return query select false, 'RESOURCE_MISMATCH', null::text, v_payment.payment_id, 'Resource mismatch';
    return;
  end if;
  select * into v_existing from public.x402_consumptions where tx_hash = p_tx_hash limit 1;
  if found then
    if v_existing.consumer_key = p_consumer_key and v_existing.resource = p_resource then
      return query select true, 'ALREADY_CONSUMED', v_existing.consumption_id, v_existing.payment_id, 'Already consumed for same resource';
      return;
    end if;
    return query select false, 'PAYMENT_REPLAY_DIFFERENT_RESOURCE', v_existing.consumption_id, v_existing.payment_id, 'Payment already consumed elsewhere';
    return;
  end if;
  v_consumption_id := 'cons_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.x402_consumptions (consumption_id, payment_id, tx_hash, requirement_id, resource, resource_method, consumer_key, status, metadata)
  values (v_consumption_id, p_payment_id, p_tx_hash, p_requirement_id, p_resource, p_resource_method, p_consumer_key, 'consumed', coalesce(p_metadata, '{}'::jsonb));
  update public.x402_payments set status = 'consumed', consumed_at = now() where payment_id = p_payment_id and status in ('verified','settled','consumed');
  return query select true, 'CONSUMED', v_consumption_id, p_payment_id, 'Payment consumed';
end;
$$;

alter table public.x402_requirements enable row level security;
alter table public.x402_payments enable row level security;
alter table public.x402_payment_attempts enable row level security;
alter table public.x402_consumptions enable row level security;
alter table public.x402_response_cache enable row level security;

drop policy if exists "x402_requirements_deny_anon" on public.x402_requirements;
drop policy if exists "x402_payments_deny_anon" on public.x402_payments;
drop policy if exists "x402_payment_attempts_deny_anon" on public.x402_payment_attempts;
drop policy if exists "x402_consumptions_deny_anon" on public.x402_consumptions;
drop policy if exists "x402_response_cache_deny_anon" on public.x402_response_cache;

create policy "x402_requirements_deny_anon" on public.x402_requirements for all to anon, authenticated using (false) with check (false);
create policy "x402_payments_deny_anon" on public.x402_payments for all to anon, authenticated using (false) with check (false);
create policy "x402_payment_attempts_deny_anon" on public.x402_payment_attempts for all to anon, authenticated using (false) with check (false);
create policy "x402_consumptions_deny_anon" on public.x402_consumptions for all to anon, authenticated using (false) with check (false);
create policy "x402_response_cache_deny_anon" on public.x402_response_cache for all to anon, authenticated using (false) with check (false);

grant usage on schema public to service_role;
grant all on public.x402_requirements to service_role;
grant all on public.x402_payments to service_role;
grant all on public.x402_payment_attempts to service_role;
grant all on public.x402_consumptions to service_role;
grant all on public.x402_response_cache to service_role;
grant execute on function public.x402_consume_payment to service_role;
