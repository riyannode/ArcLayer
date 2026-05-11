# ArcWork Indexing Layer

The contract is the source of truth. The indexer is a cache builder for fast dashboard and grant-review views.

## Event Source

`frontend/src/lib/escrow-indexer.ts` reads these MilestoneEscrow events from Arc testnet:

- `ProjectCreated`
- `ProjectFunded`
- `MilestoneSubmitted`
- `MilestoneReleased`
- `WorkProofMinted`

The same event stream can be inserted into Supabase with the transaction hash and block number as natural de-duplication keys.

## Suggested Supabase Tables

```sql
create table escrow_events (
  id bigserial primary key,
  event_name text not null,
  project_id numeric,
  milestone_id numeric,
  transaction_hash text not null,
  block_number numeric not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (transaction_hash, event_name, project_id, milestone_id)
);

create table project_cache (
  project_id numeric primary key,
  title text,
  description text,
  freelancer text,
  client text,
  total_amount numeric,
  released_amount numeric,
  status text,
  updated_block numeric not null
);
```

## Runtime Rule

If cached data disagrees with an onchain read, the onchain read wins. Cache refresh should replay events from the last processed block and then re-read affected projects from `projects(projectId)` and `milestones(projectId, milestoneId)`.
