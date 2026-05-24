create table if not exists public.x402_resource_payments (
  payment_key text primary key,
  resource text not null,
  session_id text not null,
  scope text not null,
  role text not null,
  payer text,
  pay_to text,
  amount text,
  mode text not null default 'arc-native',
  payment_id text,
  transaction text,
  status text not null check (status in ('pending','settled','failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists x402_resource_payments_resource_session_scope_role_idx
  on public.x402_resource_payments (resource, session_id, scope, role);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_x402_resource_payments_updated_at on public.x402_resource_payments;
create trigger trg_x402_resource_payments_updated_at
before update on public.x402_resource_payments
for each row execute function public.set_updated_at_timestamp();

notify pgrst, 'reload schema';
