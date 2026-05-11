<div align="center">

# ArcWork

**USDC milestone escrow for freelance projects, settled on Arc.**

[Live Demo](https://arcwork-zeta.vercel.app) · [Arc Network](https://arc.network) · [Report Bug](https://github.com/riyannode/arcwork/issues)

</div>

---

## Product

ArcWork helps freelancers and agencies create project invoices, lock client funds in USDC escrow, and release payments milestone-by-milestone on Arc.

The V1 product flow is intentionally narrow:

```text
create project -> add milestones -> client funds escrow -> freelancer submits work -> client releases payment -> completed proof
```

Out of scope for V1:

```text
subscription billing, leaderboard, PDF invoice, complex dispute flow, AI agents, RWA factoring
```

## Why Arc

ArcWork uses Arc as the settlement layer for real service payments:

- USDC is the payment unit.
- Escrow rules live in smart contracts.
- Client funds are locked before work starts.
- Payouts settle transparently when milestones are approved.
- Completed projects emit onchain proof for future reputation badges.

## Structure

```text
arcwork/
├── contracts/
│   ├── src/
│   │   ├── MilestoneEscrow.sol
│   │   ├── Achievement.sol
│   │   ├── Invoice.sol
│   │   └── Subscription.sol
│   └── test/
│       └── MilestoneEscrow.t.sol
└── frontend/
    └── src/
        ├── app/
        │   ├── dashboard/
        │   ├── invoice/
        │   ├── achievements/
        │   └── subscription/
        ├── components/
        └── lib/
```

`MilestoneEscrow.sol` is the V1 core. The older `Invoice` and `Subscription` contracts are kept for reference but are no longer the main product path.

## Smart Contracts

```bash
cd contracts
forge install OpenZeppelin/openzeppelin-contracts
forge install foundry-rs/forge-std
forge build
forge test
```

Deploy to Arc testnet:

```bash
cd contracts
USDC=0x3600000000000000000000000000000000000000 forge script script/DeployArcWork.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
```

After deploy, update `frontend/src/lib/contracts.ts`:

```ts
MILESTONE_ESCROW: '0x...'
```

## Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

Open [http://localhost:3080](http://localhost:3080).

## Arc Testnet

| Key | Value |
| --- | --- |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | [testnet.arcscan.app](https://testnet.arcscan.app) |
| Faucet | [faucet.circle.com](https://faucet.circle.com) |
| USDC | `0x3600000000000000000000000000000000000000` |

## Grant Pitch

ArcWork turns Arc into a settlement hub for freelance work: clients fund USDC escrow, freelancers submit milestones, and approved work settles instantly with onchain proof of completed paid work.
