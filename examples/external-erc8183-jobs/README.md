# External ERC-8183 Escrow Jobs

Fullcycle: `createJob(on-chain) → setBudget → approve → fund → claim(off-chain metadata) → running(off-chain) → submit → complete(on-chain)`

## Setup

```bash
npm install
cp ../external-agent-jobs/.env.example .env
```

## Demo (interactive)

```bash
node fullcycle-erc8183-demo.js
```

The demo prints tx instructions at each step. Copy them to your wallet (Foundry cast, Viem, or Arc console), sign + broadcast, then paste the tx hash to continue.

## Flow

1. `POST /api/erc8183-jobs` → create local job, returns `createJob` tx instruction
2. Broadcast `createJob` → `POST /api/erc8183-jobs/[localJobId]/created` with tx hash → stores `erc8183_job_id`
3. `POST /api/erc8183-jobs/[localJobId]/set-budget` → returns `setBudget` tx instruction
4. Broadcast `setBudget` → `POST .../tx` with tx hash to confirm
5. `POST /api/erc8183-jobs/[localJobId]/fund` → returns `approve` + `fund` tx instructions
6. Broadcast `approve` → `fund` → `POST .../tx` with fund tx hash to confirm
7. `POST /api/erc8183-jobs/[localJobId]/claim` — off-chain metadata (no tx)
8. `POST /api/erc8183-jobs/[localJobId]/running` — off-chain metadata (no tx)
9. `POST /api/erc8183-jobs/[localJobId]/submit` → returns `submit` tx instruction
10. Broadcast `submit` → `POST .../tx` to confirm
11. `POST /api/erc8183-jobs/[localJobId]/complete` → returns `complete` tx instruction
12. Broadcast `complete` → `POST .../tx` to confirm — escrow settled on-chain

## Key differences from x402 jobs

| Aspect | x402 off-chain | ERC-8183 escrow |
|---|---|---|
| Routes | `/api/agent-jobs/*` | `/api/erc8183-jobs/*` |
| Settlement | x402 Arc Native USDC transfer | On-chain `AgenticCommerce.complete()` |
| Tx signing | Server-side (x402 middleware) | User-side (returns tx instructions) |
| Private key | `X402_RELAYER_PRIVATE_KEY` + `X402_RECEIVER_ADDRESS` (server) | None needed |
| Off-chain metadata | claim/running/verify | claim/running only |

## Notes

- This is the **ERC-8183 Escrow Rail** — on-chain funded work orders only.
- ERC-8183 settlement uses on-chain escrow via `AgenticCommerce.complete()` — NOT x402 `settle()`.
- All on-chain transactions on Arc Testnet (chain ID 5042002).
- Claim and running steps are off-chain worker metadata — no smart contract interaction.
- No private key handling in this example. Tx instructions are returned, not signed.
- x402 off-chain settlement (Bridge Rail) is separate — see `examples/external-agent-jobs/`.
- Not every agent action is an escrow job. Prediction/trading/oracle agents use Bridge Rail unless a formal escrow job is created.
