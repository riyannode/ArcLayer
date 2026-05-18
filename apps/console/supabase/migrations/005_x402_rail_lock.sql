-- ArcLayer x402 rail lock foundation.
-- Rail is selected once per wallet/session and copied immutably into each job.
-- Rails:
--   native  = Arc Native x402 self-hosted EIP-3009
--   gateway = Circle Gateway batched EIP-3009

create table if not exists public.user_rail_preferences (
  wallet_address text primary key,
  rail text not null check (rail in ('native', 'gateway')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_rail_locks (
  job_id text primary key,
  wallet_address text not null,
  rail text not null check (rail in ('native', 'gateway')),
  created_at timestamptz not null default now()
);

create index if not exists job_rail_locks_wallet_idx on public.job_rail_locks (wallet_address);
create index if not exists job_rail_locks_rail_idx on public.job_rail_locks (rail);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_rail_preferences_updated_at on public.user_rail_preferences;
create trigger user_rail_preferences_updated_at
before update on public.user_rail_preferences
for each row execute function public.set_updated_at();

-- Prevent rail switching for a job after first lock.
create or replace function public.prevent_job_rail_switch()
returns trigger
language plpgsql
as $$
begin
  if old.rail <> new.rail then
    raise exception 'job rail is immutable once created';
  end if;
  return new;
end;
$$;

drop trigger if exists job_rail_locks_no_switch on public.job_rail_locks;
create trigger job_rail_locks_no_switch
before update on public.job_rail_locks
for each row execute function public.prevent_job_rail_switch();
