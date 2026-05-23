# ArcLayer Indexing Layer

The contract is the source of truth. The indexer is a cache builder for fast dashboard and grant-review views.

## Event Source

ArcLayer production reference mode indexes ERC-8183 AgenticCommerce and ERC-8004 registry events via the dedicated indexer service.

Human-to-Agent Vault and other custom modules are future/optional surfaces and should be indexed separately when enabled.

## Runtime Rule

If cached data disagrees with an onchain read, the onchain read wins.
