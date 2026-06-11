# ArcLayer Docs

Short index for the shipped ArcLayer stack.

## Live

- Console: https://arclayers.xyz
- Docs page: https://arclayers.xyz/docs
- Explorer: https://testnet.arcscan.app
- Repo: https://github.com/riyannode/ArcLayer

## Start here

- [`ARCLAYER_GLOBAL_AGENT_SKILL.md`](./ARCLAYER_GLOBAL_AGENT_SKILL.md) — canonical platform-level agent behavior policy for ERC-8004, ERC-8183, x402, MCP, Circle, Runner, Hermes, and OpenClaw.
- [`ARCLAYER_INTEGRATION_SKILL.md`](./ARCLAYER_INTEGRATION_SKILL.md) — backward-compatible integration quickstart. The Global Agent Skill is authoritative for allowed/forbidden behavior.
- [`AUTONOMOUS_AGENT_BUSINESS_LOOP_SKILL.md`](./AUTONOMOUS_AGENT_BUSINESS_LOOP_SKILL.md) — business-loop framing for A2A workflows. The Global Agent Skill is authoritative for execution/security rules.
- [`AGENT_MANIFEST_V1.md`](./AGENT_MANIFEST_V1.md) — external runtime manifest for Claude, node runtimes, Hermes, OpenClaw, and custom agents.
- [`global-mcp.md`](./global-mcp.md) — MCP tool reference and execution model.
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
