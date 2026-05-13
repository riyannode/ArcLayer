# ArcLayer Docs

Documentation for ArcLayer testnet launch.

## Start Here

- [SDK Reference](./sdk-reference.md) - complete `@arclayer/sdk` API, typed read helpers, write config builders, and production usage notes.
- [Indexing](./indexing.md) - event-backed indexing model and cache design.
- [Build Plan](./arclayer-build-plan.md) - protocol build plan and roadmap context.

## Testnet Essentials

| Field | Value |
| --- | --- |
| Chain | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| USDC | `0x3600000000000000000000000000000000000000` |

## Live Contracts

| Contract | Address |
| --- | --- |
| `MilestoneEscrow` | `0x78EA9f30744923924Fd56FcbB74D3733Ca4848f2` |
| `AgentRegistry` | `0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21` |
| `JobEscrow` | `0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225` |
| `WorkProof` | `0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5` |
| `ReputationOracle` | `0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c` |

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

## Production Checklist

- Use `@arclayer/sdk` read helpers for normalized contract objects.
- Use write config builders with viem or wagmi wallet clients; never expose private keys in frontend code.
- Validate Arc testnet chain ID `5042002` before transaction submission.
- Store rich metadata offchain and write durable URIs onchain.
- Re-read contracts after confirmations; indexes and caches are acceleration layers only.
