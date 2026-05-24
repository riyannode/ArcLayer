# Supabase schema inventory

This inventory reflects canonical migrations in both locations:
- `supabase/migrations`
- `apps/console/supabase/migrations`

## Core A2A / Arc identity

- `public.agent_manifests` from `supabase/migrations/0001_agent_manifests.sql`.
- `public.a2a_jobs` from `supabase/migrations/0008_a2a_jobs.sql`.
- `public.a2a_api_keys` from `supabase/migrations/0009_a2a_api_keys.sql`.
- `public.a2a_jobs` on-chain lifecycle columns/patches from `supabase/migrations/0010_a2a_jobs_onchain_lifecycle.sql`.

## A2A webhooks

- `public.a2a_webhooks` from `supabase/migrations/20260519_phase14_webhooks.sql`.
- `public.a2a_webhook_deliveries` from `supabase/migrations/20260519_phase14_webhooks.sql`.

## External agent bridge / PM2 runtime history

- `public.agent_bridge_events` from `supabase/migrations/0011_agent_bridge_events_receipts.sql`.
- `public.agent_bridge_receipts` from `supabase/migrations/0011_agent_bridge_events_receipts.sql`.
- `public.external_agent_runtimes` from `supabase/migrations/0012_external_agent_runtimes.sql`.
- `apps/console/supabase/migrations/011_agent_bridge_events.sql` exists as a legacy/stale console-side variant compared to the root `supabase/migrations` schema set.

## x402 / payment guards

- `public.x402_gateway_payments` from `apps/console/supabase/migrations/002_x402_gateway_payments.sql`.
- `public.x402_native_payments` from `apps/console/supabase/migrations/003_x402_native_payments.sql`.
- replay guard patches from `apps/console/supabase/migrations/004_x402_payment_replay_guards.sql`.
- `public.user_rail_preferences` and `public.job_rail_locks` from `apps/console/supabase/migrations/005_x402_rail_lock.sql`.
- `public.x402_access_sessions` from `apps/console/supabase/migrations/006_x402_access_sessions.sql`.

## Vault

- `public.vault_jobs` from `apps/console/supabase/migrations/007_vault_system.sql`.
- `public.vault_milestones` from `apps/console/supabase/migrations/007_vault_system.sql`.
- `public.vault_disputes` from `apps/console/supabase/migrations/007_vault_system.sql`.
- `public.bond_tiers` from `apps/console/supabase/migrations/007_vault_system.sql`.
- `public.vault_config` from `apps/console/supabase/migrations/007_vault_system.sql`.
- `public.resolver_decisions` from `apps/console/supabase/migrations/007_vault_system.sql`.
- `public.jobber_reputation` from `apps/console/supabase/migrations/007_vault_system.sql`.
- `public.client_reputation` from `apps/console/supabase/migrations/007_vault_system.sql`.
- on-chain field and schema patches from `apps/console/supabase/migrations/008_vault_onchain_fields.sql` and `apps/console/supabase/migrations/009_vault_onchain_schema_patch.sql`.

## Live A2A UI

- `public.agent_live_events` from `apps/console/supabase/migrations/20260523_agent_live_events.sql`.
- `public.agent_presence` from `apps/console/supabase/migrations/20260523_agent_live_events.sql`.

## Removed

- `public.a2a_trades` from deleted `apps/console/supabase/migrations/010_a2a_trades.sql`.
