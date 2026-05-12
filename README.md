<div align="center">

# ArcLayer

**Protocol layer for the agentic economy**

[Live App](https://frontend-rouge-eta-64.vercel.app) · [Arc Explorer](https://testnet.arcscan.app) · [Arc Network](https://arc.network)

</div>

## Overview

ArcLayer is the protocol pivot of the original escrow repo. The repository now carries:

- the legacy `MilestoneEscrow` path that is already live on Arc testnet
- a new contract-layer scaffold for `JobEscrow`, `AgentRegistry`, `WorkProof`, and `ReputationOracle`
- a workspace SDK in `sdk/`
- a standalone indexer scaffold in `indexer/`
- a protocol console in `apps/console/`

The current live flow is still:

`createProject -> fundProject -> submitMilestone -> approveMilestone -> release USDC -> emit WorkProof`

## What Is Live

Public app:

- [https://frontend-rouge-eta-64.vercel.app](https://frontend-rouge-eta-64.vercel.app)

Arc testnet deployment:

| Contract | Address |
| --- | --- |
| `MilestoneEscrow` | `0x78EA9f30744923924Fd56FcbB74D3733Ca4848f2` |
| `Achievement` | `0x7245B200ce09B515bd235f1eD262c2abb0890165` |
| `AgentRegistry` | `0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21` |
| `WorkProof` | `0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5` |
| `JobEscrow` | `0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225` |
| `ReputationOracle` | `0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c` |
| Testnet USDC | `0x3600000000000000000000000000000000000000` |

Legacy deploy proof:

- `MilestoneEscrow`: [0xd10476a06b942348a22b32faea36e53f2b6d5f8ad1c6f4a0eb9f3e36d23ded10](https://testnet.arcscan.app/tx/0xd10476a06b942348a22b32faea36e53f2b6d5f8ad1c6f4a0eb9f3e36d23ded10)

Protocol deploy proof:

- `AgentRegistry`: [0xc973a730482eeb67ce17a7e04a96200a3d50bfcc4905ace265b04d9cf7fafbb9](https://testnet.arcscan.app/tx/0xc973a730482eeb67ce17a7e04a96200a3d50bfcc4905ace265b04d9cf7fafbb9)
- `WorkProof`: [0x567eab55746b2b567304d61201dba18b80c3698bbaa7ca9830a8832051c5d35a](https://testnet.arcscan.app/tx/0x567eab55746b2b567304d61201dba18b80c3698bbaa7ca9830a8832051c5d35a)
- `JobEscrow`: [0x2b3e900692641a48080e705e959fcf8135fb7829100756ffa2b37ae6b9bedc45](https://testnet.arcscan.app/tx/0x2b3e900692641a48080e705e959fcf8135fb7829100756ffa2b37ae6b9bedc45)
- `ReputationOracle`: [0x5232aa8778a30f78d1173a5d36aa6dc17378c14af6cd4c9c3a9e985e5bf3256f](https://testnet.arcscan.app/tx/0x5232aa8778a30f78d1173a5d36aa6dc17378c14af6cd4c9c3a9e985e5bf3256f)

## End-to-End Proof

Project `0` was completed end-to-end on Arc testnet.

| Step | Tx |
| --- | --- |
| `createProject` | [0x54393be919309c6492145606e135f0191297d4fc6f7f0cb11194b354b4ea45ab](https://testnet.arcscan.app/tx/0x54393be919309c6492145606e135f0191297d4fc6f7f0cb11194b354b4ea45ab) |
| `approve USDC` | [0x76a3708537431f071cbf304af07d124009eddcf1cfa2c87fa352e1a201998775](https://testnet.arcscan.app/tx/0x76a3708537431f071cbf304af07d124009eddcf1cfa2c87fa352e1a201998775) |
| `fundProject` | [0xa79c140210befdcaaf7b56979a57dd054490016bb66dc6bff5e2ae939412fb6e](https://testnet.arcscan.app/tx/0xa79c140210befdcaaf7b56979a57dd054490016bb66dc6bff5e2ae939412fb6e) |
| `submitMilestone(0)` | [0x17342a444ab7d142fc8c900316786471c55d53f03644cb36ce94e6cfdf03f32f](https://testnet.arcscan.app/tx/0x17342a444ab7d142fc8c900316786471c55d53f03644cb36ce94e6cfdf03f32f) |
| `approveMilestone(0)` | [0x2b5cbd9a83fad46f57562595272b1cb94ecbcc16b55b499997ac4d1ca6ecc0d7](https://testnet.arcscan.app/tx/0x2b5cbd9a83fad46f57562595272b1cb94ecbcc16b55b499997ac4d1ca6ecc0d7) |
| `submitMilestone(1)` | [0x410e0c18551b2cbc459e6708977dcbd728bdea8cf103168fcc563eca851ce79e](https://testnet.arcscan.app/tx/0x410e0c18551b2cbc459e6708977dcbd728bdea8cf103168fcc563eca851ce79e) |
| `approveMilestone(1)` + `WorkProofMinted` | [0xd68f8e8a77b5d7101c9954f81463c58fe4ffbec514930ffeb36e5845489cf767](https://testnet.arcscan.app/tx/0xd68f8e8a77b5d7101c9954f81463c58fe4ffbec514930ffeb36e5845489cf767) |

Final onchain state for project `0`:

- `totalAmount = 2000000`
- `releasedAmount = 2000000`
- `milestoneCount = 2`
- `status = Completed`

## App Routes

| Route | Purpose |
| --- | --- |
| `/invoice` | Creates milestone projects onchain via `createProject` |
| `/dashboard` | Reads connected-wallet project IDs and expands them into live project data |
| `/project/[id]` | Reads `projects(id)` and all project milestones directly from the contract |
| `/achievements` | Reads user-linked escrow project IDs for proof-oriented views |

## Architecture

```text
Console (Next.js + wagmi + viem)
        |
        +--> MilestoneEscrow.sol on Arc testnet
        |       |
        |       +--> ProjectCreated
        |       +--> ProjectFunded
        |       +--> MilestoneSubmitted
        |       +--> MilestoneReleased
        |       +--> WorkProofMinted
        |
        +--> sdk/
        |
        +--> indexer/
```

The contract remains the source of truth. Cached metadata should only accelerate reads and never override onchain state.

## Repo Layout

```text
arclayer/
├── contracts/
├── sdk/
├── indexer/
├── apps/
│   └── console/
├── docs/
└── demo-video/
```

`MilestoneEscrow.sol` remains the live V1 core for the current console reads, while the newly deployed ArcLayer modules are live on testnet and recorded in `sdk/src/addresses.ts`.

## Local Development

Contracts:

```bash
cd contracts
forge install
forge build
forge test
```

Console:

```bash
corepack pnpm install
corepack pnpm --dir apps/console dev
```

## Arc Testnet Config

| Key | Value |
| --- | --- |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` |
| USDC | `0x3600000000000000000000000000000000000000` |

## Indexing Notes

`docs/indexing.md` describes the lightweight indexing layer and optional Supabase schema. The intended model is:

- contract events are canonical
- the indexer replays events and caches derived metadata
- any cache mismatch is resolved by rereading contract state

## Scope Boundaries

Out of scope for V1:

- dispute resolution
- subscription billing as the main product path
- PDF invoice generation
- AI workflow automation
- credit underwriting or factoring

## Summary

ArcLayer already has:

- a deployed milestone escrow contract on Arc testnet
- a public frontend wired to the live contract
- explorer proof for deploy and completed flow
- live contract reads for invoice, dashboard, and project views
- an event-backed indexing design for caching without breaking source-of-truth guarantees
