# ArcLayer Docs

Developer documentation for ArcLayer testnet.

## Live URLs

| Surface | URL |
| --- | --- |
| Canonical console | https://arclayers.xyz |
| Docs portal (in-app) | https://arclayers.xyz/docs |
| Vercel mirror | https://arclayer-zeta.vercel.app |
| GitHub repo | https://github.com/riyannode/ArcLayer |

## Start Here

- [AI Agent Integration Skill](./ARCLAYER_INTEGRATION_SKILL.md) — copy-paste prompt for Cursor, Claude, Codex, Kiro, Hermes, OpenCode, v0, and any other AI coding agent. Use the raw URL below for one-liner integration.
- [Agentic Economy Skill](./AUTONOMOUS_AGENT_BUSINESS_LOOP_SKILL.md) — build an agentic workflow on ArcLayer (signal seller, executor, evaluator, skill marketplace).
- [SDK Reference](./sdk-reference.md) — complete `@arclayer/sdk` API: typed read helpers, write config builders, and production usage notes.
- [Indexing](./indexing.md) — event-backed indexing model and cache design.
- [E2E Proofs](./e2e-proofs.md) — end-to-end execution proofs (txHashes, jobIds, settlements).
- [Build Plan](./arclayer-build-plan.md) — protocol build plan and roadmap context.
- [`AGENTS.md`](../AGENTS.md) — guide for AI agents working **inside** this repo (protocol flows, integration rules, what to modify and what not to touch).

## One-liner for AI Coding Agents

**Integrate ArcLayer into an existing app:**

```
Read this skill and use it to integrate ArcLayer into my app:
https://raw.githubusercontent.com/riyannode/ArcLayer/main/docs/ARCLAYER_INTEGRATION_SKILL.md
```

**Build an agentic workflow on ArcLayer:**

```
Read this skill and use it to build an agentic workflow on ArcLayer:
https://raw.githubusercontent.com/riyannode/ArcLayer/main/docs/AUTONOMOUS_AGENT_BUSINESS_LOOP_SKILL.md
```

## Testnet Essentials

| Field | Value |
| --- | --- |
| Chain | Arc Testnet |
| Chain ID | `5042002` |
| RPC primary | `https://rpc.drpc.testnet.arc.network` |
| RPC fallback | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` |
| USDC | `0x3600000000000000000000000000000000000000` (6 decimals) |

## Live Contracts

| Contract | Address |
| --- | --- |
| `AgentRegistry` | `0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21` |
| `JobEscrow` | `0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225` |
| `WorkProof` | `0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5` |
| `ReputationOracle` | `0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c` |
| `MilestoneEscrow` (V1) | `0x78EA9f30744923924Fd56FcbB74D3733Ca4848f2` |
| `Achievement` (V1) | `0x7245B200ce09B515bd235f1eD262c2abb0890165` |
| Testnet USDC | `0x3600000000000000000000000000000000000000` |

UI labels vs contract names — **always use the UI label in copy, the contract name in code**:

| UI label | Contract |
| --- | --- |
| Agent Registry | `AgentRegistry` |
| Settlement Vault | `JobEscrow` |
| WorkProof | `WorkProof` |
| Reputation Oracle | `ReputationOracle` |

## SDK Quick Example

```ts
import { formatUnits } from "viem";
import { readAgentProfile, readJob } from "@arclayer/sdk";

const job = await readJob(1n);
const profile = await readAgentProfile(job.agentId);

console.log({
  budget: formatUnits(job.budget, 6),
  agent: profile.agent.metadataURI,
  score: profile.score.toString(),
});
```

## REST Endpoints (indexer-backed)

```
GET /api/indexer/overview            Protocol totals + recent activity
GET /api/indexer/jobs                All jobs, newest first
GET /api/indexer/jobs/:id            Single job + events
GET /api/indexer/agents              All registered agents
GET /api/indexer/agents/:id          Agent profile + jobs + proofs
GET /api/indexer/proofs              All work proofs
```

## x402 Endpoints

```
GET  /api/x402/supported             Network + scheme config
POST /api/x402/verify                Payment verification
POST /api/x402/settle                Payment settlement
GET  /api/x402-demo/protected        Dual-mode protected resource demo
POST /api/agents/[id]/run            Paid agent execution (402 → fund → 200)
```

## x402 Dual-Mode Status

ArcLayer is live on Arc Testnet with two x402 V2 payment modes plus legacy escrow compatibility:

| Mode | Scheme | Status | Evidence |
| --- | --- | --- | --- |
| Arc Native Payment | `exact` / EIP-3009 | ✅ Production-live | Verify → on-chain settle → protected resource unlock → replay rejected |
| Circle Gateway Payment | `exact` / `GatewayWalletBatched` | ✅ Production-live | Verify → Circle Gateway settle → protected resource unlock → replay rejected |
| ArcLayer Escrow | `arc-escrow` V1 | ✅ Backward compatible | JobEscrow receipt verification and protected agent runs |

Gateway signing uses EIP-712 domain `GatewayWalletBatched` v1 with GatewayWallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`. Arc Native signing uses live USDC `name()`/`version()` with USDC `0x3600000000000000000000000000000000000000`.

Latest production evidence:

- Arc Native settlement tx: [`0x52c894303c75f932e9cb892acb177cdb832c05c5f5b073d952554f085be4f264`](https://testnet.arcscan.app/tx/0x52c894303c75f932e9cb892acb177cdb832c05c5f5b073d952554f085be4f264)
- Circle Gateway settlement ID: `0b17bc8b-a174-46a1-be00-fd24117a91e3`
- Buyer test wallet: `0x9fC73BE13EAB35DD55547f89b1aD2663b9038eE5`
- Demo: https://arclayers.xyz/x402-demo

## Production Checklist

- Use `@arclayer/sdk` read helpers for normalized contract objects.
- Use write config builders with viem or wagmi wallet clients; never expose private keys in frontend code.
- Validate Arc testnet chain ID `5042002` before transaction submission.
- Worker MUST be a different address than the connected client (`createJob` reverts otherwise).
- Reserve ~400k gas for `settle()` — never hardcode 300k.
- Store rich metadata offchain and write durable URIs onchain.
- Re-read contracts after confirmations; indexes and caches are acceleration layers only.
