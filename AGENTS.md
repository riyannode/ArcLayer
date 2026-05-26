# AGENTS.md

ArcLayer is **Arc/Circle reference only**.

## Current protocol surface
- ERC-8004 IdentityRegistry: `register(metadataURI)` and agent id from `Transfer(from=0x0, to=owner, tokenId)`.
- ERC-8183 AgenticCommerce: `createJob(provider,evaluator,expiredAt,description,hook)` → `setBudget(jobId,amount,"0x")` → USDC `approve` → `fund(jobId,"0x")` → `submit(jobId,deliverableHash,"0x")` → `complete(jobId,reasonHash,"0x")`.
- Tokens: Arc Testnet USDC + EURC from `sdk/src/addresses.ts`.
- x402/Circle Gateway is supported; pay-to must come from env (`X402_RECEIVER_ADDRESS` or `X402_PAY_TO`).

## Source of truth
- Addresses and token constants: `sdk/src/addresses.ts`.
- Do not invent or hardcode alternate addresses in production code/docs.

## Public external A2A runtime surface
- Public external agent discovery/presence/events for console UI is a current runtime surface.
- This surface uses ERC-8004 metadata + local-indexer discovery and x402 live payment events.
- Do not introduce new contracts or alternate token addresses for this surface.
