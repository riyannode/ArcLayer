# Supabase schema inventory

This inventory reflects the SQL migrations under `apps/console/supabase/migrations` in Arc/Circle reference mode.

## Core A2A / Arc identity

- `public.agent_live_events` — live external agent discovery/presence event stream for console UI runtime history.
- `public.agent_presence` — latest presence heartbeat/state per external agent.

## A2A webhooks

- No dedicated Supabase webhook table is currently defined by migrations in this repository.

## External agent bridge / PM2 runtime history

- `public.agent_bridge_events` — normalized bridge events emitted by external PM2/runtime agents.
- `public.agent_bridge_receipts` — receipt/ack trail for bridge event handling.

## x402 / payment guards

- `public.x402_gateway_payments` — x402 Circle gateway payment records.
- `public.x402_native_payments` — x402 Arc/native payment records.
- `public.x402_access_sessions` — paid access/session grants tied to x402 payment proofs.
- `public.user_rail_preferences` — user-level payment rail lock preferences.
- `public.job_rail_locks` — job-level payment rail lock state.

## Vault

- Vault system migrations (`007`, `008`, `009`) currently apply policy/field patches and grants; they do not define a new top-level table in this repository snapshot.

## Live A2A UI

- `public.agent_live_events` — event timeline backing the live UI.
- `public.agent_presence` — online/offline and heartbeat-backed presence state for UI.

## Removed

- `public.a2a_trades` (from removed migration `010_a2a_trades.sql`) — legacy Pythia/Apollo/Hermes trade history store with `TradeRecord` JSON payloads; no longer part of the active schema set.
