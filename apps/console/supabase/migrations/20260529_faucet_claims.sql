-- Faucet claims table — run this on Supabase before deploying the faucet feature.
-- Dashboard > SQL Editor > New query > paste > Run.

create table if not exists faucet_claims (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  ip_hash text,
  amount_usdc numeric not null,
  tx_hash text,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

create index if not exists faucet_claims_wallet_created_idx
on faucet_claims (lower(wallet_address), created_at desc);

create index if not exists faucet_claims_ip_created_idx
on faucet_claims (ip_hash, created_at desc);
