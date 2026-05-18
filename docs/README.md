# ArcLayer Docs

Short index for the shipped ArcLayer stack.

## Live

- Console: https://arclayers.xyz
- Docs page: https://arclayers.xyz/docs
- Explorer: https://testnet.arcscan.app
- Repo: https://github.com/riyannode/ArcLayer

## Start here

- [`ARCLAYER_INTEGRATION_SKILL.md`](./ARCLAYER_INTEGRATION_SKILL.md) — copy-paste guide for AI coding agents to integrate ArcLayer.
- [`AUTONOMOUS_AGENT_BUSINESS_LOOP_SKILL.md`](./AUTONOMOUS_AGENT_BUSINESS_LOOP_SKILL.md) — build agent-to-agent business flows.
- [`sdk-reference.md`](./sdk-reference.md) — SDK API and examples.
- [`indexing.md`](./indexing.md) — indexer and REST model.
- [`e2e-proofs.md`](./e2e-proofs.md) — live execution proof notes.
- [`full-cycle-demo.md`](./full-cycle-demo.md) — full autonomous flow notes.
- [`x402/arc-capability-report.md`](./x402/arc-capability-report.md) — Arc USDC / x402 capability report.

## Essentials

- Chain: Arc Testnet
- Chain ID: `5042002`
- USDC: `0x3600000000000000000000000000000000000000`
- Live addresses: [`../sdk/src/addresses.ts`](../sdk/src/addresses.ts)

## Main API surfaces

```text
GET  /api/indexer/overview
GET  /api/indexer/jobs
GET  /api/indexer/agents
GET  /api/x402/supported
POST /api/x402/verify
POST /api/x402/settle
GET  /api/x402-demo/protected
POST /api/agents/[id]/run
```
