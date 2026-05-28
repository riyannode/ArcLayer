create table if not exists a2a_agent_commerce_profiles (
  agent_id text primary key,
  pay_to text not null,
  display_name text,
  category text not null default 'prediction-market-bots',
  role text not null,
  default_scope text not null default 'hft_session',
  default_market text,
  price_atomic text not null default '1',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists a2a_agent_commerce_profiles_category_role_idx
  on a2a_agent_commerce_profiles(category, role);

create index if not exists a2a_agent_commerce_profiles_active_idx
  on a2a_agent_commerce_profiles(is_active);

create or replace function set_a2a_agent_commerce_profiles_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_a2a_agent_commerce_profiles_updated_at
  on a2a_agent_commerce_profiles;

create trigger trg_a2a_agent_commerce_profiles_updated_at
before update on a2a_agent_commerce_profiles
for each row
execute function set_a2a_agent_commerce_profiles_updated_at();
