# ArcLayer Contracts

The contract workspace is in staged migration from the original `MilestoneEscrow.sol` app contract toward an
ArcLayer protocol stack.

Active protocol modules:

- `JobEscrow.sol`
- `AgentRegistry.sol`
- `WorkProof.sol`
- `ReputationOracle.sol`

Current Arc testnet protocol addresses:

- `AgentRegistry`: `0x9fe01a9AF637402c53B23571a0EbDA6b2127DC21`
- `WorkProof`: `0xf4c4aaff0AAC4F22De4a3CD497Db6803279fFEb5`
- `JobEscrow`: `0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225`
- `ReputationOracle`: `0x4D3296F4F3e9135042EfFF8134631dbF359aDb8c`

Legacy reference modules:

- `src/MilestoneEscrow.sol`
- `archive/Invoice.sol`
- `archive/Subscription.sol`

## Core Flow

```text
client creates job
client sets budget and funds escrow
worker submits deliverable
evaluator approves outcome
USDC settles to worker
WorkProof mints on completion
```

## Commands

```bash
forge build
forge test
```

## Deploy

```bash
USDC=0x3600000000000000000000000000000000000000 forge script script/DeployArcLayer.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
```

Update `sdk/src/addresses.ts` with deployed protocol addresses after deployment.
