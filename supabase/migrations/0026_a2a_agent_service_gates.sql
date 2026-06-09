-- 0026: A2A x402 service gates
-- Adds multi-gate, per-service-agent pricing for x402 nanopayments.
-- Does not modify ERC-8183.

create table if not exists public.a2a_agent_service_gates (
  id uuid primary key default gen_random_uuid(),

  -- Agent/bot that owns and exposes this paid x402 service gate.
  -- Do not call this provider_agent_id to avoid ERC-8183 provider-role collision.
  service_agent_id text not null,

  -- Stable service key owned by the service agent.
  -- Examples: market_data_basic, orderbook_depth, risk_check_v1.
  gate_key text not null,

  category text not null default 'prediction-market-bots',

  -- x402 service/capability role, not ERC-8183 participant role.
  -- Examples: oracle, analyzer, risk_evaluator, executor, solver, verifier.
  service_role text not null,

  scope text not null,
  access_type text not null,
  market text not null default '*',

  -- USDC atomic amount, 6 decimals.
  -- Example: 2000 = 0.002 USDC.
  price_atomic text not null,
  currency text not null default 'USDC',

  -- Current production rail for A2A nanopayments.
  rail text not null default 'circle-gateway',

  -- Optional payout override.
  -- If null, code should fallback to a2a_agent_commerce_profiles.pay_to.
  pay_to text,

  reputation_eligible boolean not null default false,
  llm_receipt_required boolean not null default false,

  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint a2a_agent_service_gates_rail_check
    check (rail in ('circle-gateway', 'arc-native')),

  constraint a2a_agent_service_gates_currency_check
    check (currency = 'USDC'),

  constraint a2a_agent_service_gates_price_positive_check
    check (price_atomic ~ '^[0-9]+$' and price_atomic::numeric > 0),

  constraint a2a_agent_service_gates_service_role_slug_check
    check (service_role ~ '^[a-z0-9:_-]{1,64}$'),

  constraint a2a_agent_service_gates_scope_slug_check
    check (scope ~ '^[a-z0-9:_-]{1,96}$'),

  constraint a2a_agent_service_gates_access_type_slug_check
    check (access_type ~ '^[a-z0-9:_-]{1,96}$'),

  constraint a2a_agent_service_gates_category_slug_check
    check (category ~ '^[a-z0-9:_-]{1,96}$'),

  constraint a2a_agent_service_gates_gate_key_slug_check
    check (gate_key ~ '^[a-z0-9:_-]{1,96}$')
);

create unique index if not exists uniq_a2a_agent_service_gate_active
  on public.a2a_agent_service_gates (
    service_agent_id,
    gate_key,
    category,
    service_role,
    scope,
    access_type,
    market,
    rail
  )
  where is_active = true;

create index if not exists idx_a2a_agent_service_gates_agent
  on public.a2a_agent_service_gates (service_agent_id)
  where is_active = true;

create index if not exists idx_a2a_agent_service_gates_lookup
  on public.a2a_agent_service_gates (
    category,
    service_role,
    scope,
    access_type,
    market,
    rail
  )
  where is_active = true;

create index if not exists idx_a2a_agent_service_gates_gate_key
  on public.a2a_agent_service_gates (gate_key)
  where is_active = true;

create or replace function public.set_a2a_agent_service_gates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_a2a_agent_service_gates_updated_at
  on public.a2a_agent_service_gates;

create trigger trg_a2a_agent_service_gates_updated_at
before update on public.a2a_agent_service_gates
for each row
execute function public.set_a2a_agent_service_gates_updated_at();

alter table public.a2a_agent_service_gates enable row level security;

drop policy if exists a2a_agent_service_gates_service_role_all
  on public.a2a_agent_service_gates;

create policy a2a_agent_service_gates_service_role_all
  on public.a2a_agent_service_gates
  for all
  to service_role
  using (true)
  with check (true);
