-- Add event_dedupe_key column for content event deduplication
-- Only content events (market_snapshot, resolver_output, evaluation, execution_intent)
-- get a dedupe key. receipt_reference events have NULL event_dedupe_key.
--
-- The unique partial index (WHERE event_dedupe_key IS NOT NULL) ensures:
--   - Old rows (NULL) are untouched — no migration failure
--   - Only content events are subject to dedup
--   - Duplicate insert of same (sessionId + agentId + role + type) is caught by Postgres

alter table public.agent_bridge_events
  add column if not exists event_dedupe_key text;

create unique index if not exists agent_bridge_events_event_dedupe_key_idx
  on public.agent_bridge_events (event_dedupe_key)
  where event_dedupe_key is not null;
