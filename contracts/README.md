# ArcWork Contracts

V1 centers on `MilestoneEscrow.sol`: a USDC escrow contract for freelance projects with milestone-based release.

## Core Flow

```text
freelancer creates project
client funds escrow
freelancer submits milestone
client approves milestone
USDC releases to freelancer
completed project emits proof event
```

## Commands

```bash
forge build
forge test
```

## Deploy

```bash
USDC=0x3600000000000000000000000000000000000000 forge script script/DeployArcWork.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
```

Update `frontend/src/lib/contracts.ts` with the deployed `MilestoneEscrow` address after deployment.
