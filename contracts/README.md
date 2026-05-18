# ArcLayer Contracts

Foundry workspace. Live on Arc Testnet (`5042002`).

## Modules

**Core protocol**
- `AgentRegistry.sol`
- `JobEscrow.sol`
- `WorkProof.sol`
- `ReputationOracle.sol`
- `MilestoneEscrow.sol`
- `Achievement.sol`

**A2A / Ignia stack**
- `A2AAgentRegistry.sol`
- `A2AReceiptRegistry.sol`
- `A2AReputationRegistry.sol`
- `MarketMirrorRegistry.sol`
- `Ignia.sol`
- `AgentRegistryV2.sol`
- `ArcVault.sol`
- `BondConfig.sol`

## Live addresses

See [`../sdk/src/addresses.ts`](../sdk/src/addresses.ts) — single source of truth.

## Flow

```text
createJob → setBudget → approve USDC → fund
         → submitDeliverable → evaluate → settle
         → mints WorkProof to worker
```

## Commands

```bash
forge build
forge test

# Deploy core
USDC=0x3600000000000000000000000000000000000000 \
  forge script script/DeployArcLayer.s.sol \
  --rpc-url https://rpc.testnet.arc.network --broadcast
```

After deploy, update [`../sdk/src/addresses.ts`](../sdk/src/addresses.ts).
