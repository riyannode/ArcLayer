# ArcLayer Integration Skill (Current)

ArcLayer currently runs on Arc reference contracts for ERC-8004 agent identity, reputation, validation, ERC-8183 paid jobs, and x402 payments on Arc Testnet USDC.

Use this integration profile:
- ERC-8004 IdentityRegistry: `register(metadataURI)` and derive agent id from mint `Transfer` tokenId.
- ERC-8004 ReputationRegistry and ERC-8004 ValidationRegistry for reputation/validation rails.
- ERC-8183 AgenticCommerce: `createJob` + `setBudget` + USDC `approve` + `fund` + `submit` + `complete`.
- x402 Arc Native payment; optional Circle Gateway support where already documented.
- PM2 external agent bridge with bridge receipts, payload hashes, and live proof history.
- ArcLayer exposes a custom MCP-style API at `/api/mcp`; official Arc MCP server is https://docs.arc.io/mcp.
- Use `sdk/src/addresses.ts` as the canonical address source (do not hardcode alternate addresses).
- For x402 pay-to, require `X402_RECEIVER_ADDRESS` or `X402_PAY_TO`.

Human-to-Agent Vault is a planned custom ArcLayer module for milestone-based human-to-agent work, dispute handling, and resolver-backed settlement.
