<div align="center">

# ArcWork

**Milestone-based USDC escrow for freelance work on Arc testnet**

[Live App](https://frontend-rouge-eta-64.vercel.app) · [Arc Explorer](https://testnet.arcscan.app) · [Arc Network](https://arc.network)

</div>

## Overview

ArcWork turns freelance project settlement into an onchain flow:

`createProject -> fundProject -> submitMilestone -> approveMilestone -> release USDC -> emit WorkProof`

The product surface is intentionally narrow for V1:

- freelancers define project scope and milestone payouts
- clients lock the full USDC amount into escrow before work starts
- milestone releases happen only after client approval
- completed work emits onchain proof for later reputation systems

## What Is Live

Public app:

- [https://frontend-rouge-eta-64.vercel.app](https://frontend-rouge-eta-64.vercel.app)

Arc testnet deployment:

| Contract | Address |
| --- | --- |
| `MilestoneEscrow` | `0x78EA9f30744923924Fd56FcbB74D3733Ca4848f2` |
| `Achievement` | `0x7245B200ce09B515bd235f1eD262c2abb0890165` |
| Testnet USDC | `0x3600000000000000000000000000000000000000` |

Deploy proof:

- `MilestoneEscrow`: [0xd10476a06b942348a22b32faea36e53f2b6d5f8ad1c6f4a0eb9f3e36d23ded10](https://testnet.arcscan.app/tx/0xd10476a06b942348a22b32faea36e53f2b6d5f8ad1c6f4a0eb9f3e36d23ded10)

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
Frontend (Next.js + wagmi + viem)
        |
        +--> MilestoneEscrow.sol on Arc testnet
        |       |
        |       +--> ProjectCreated
        |       +--> ProjectFunded
        |       +--> MilestoneSubmitted
        |       +--> MilestoneReleased
        |       +--> WorkProofMinted
        |
        +--> Optional event indexer / Supabase cache
```

The contract remains the source of truth. Cached metadata should only accelerate reads and never override onchain state.

## Repo Layout

```text
arcwork/
├── contracts/
│   ├── src/
│   │   ├── MilestoneEscrow.sol
│   │   ├── Achievement.sol
│   │   ├── Invoice.sol
│   │   └── Subscription.sol
│   ├── script/
│   └── test/
├── docs/
│   └── indexing.md
└── frontend/
    └── src/
        ├── app/
        ├── components/
        └── lib/
```

`MilestoneEscrow.sol` is the V1 core. `Invoice.sol` and `Subscription.sol` are legacy references and are not the primary settlement path.

## Local Development

Contracts:

```bash
cd contracts
forge install
forge build
forge test
```

Frontend:

```bash
cd frontend
pnpm install
pnpm dev
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

ArcWork already has:

- a deployed milestone escrow contract on Arc testnet
- a public frontend wired to the live contract
- explorer proof for deploy and completed flow
- live contract reads for invoice, dashboard, and project views
- an event-backed indexing design for caching without breaking source-of-truth guarantees
