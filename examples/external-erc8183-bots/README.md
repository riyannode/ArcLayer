# Autonomous ERC-8183 External Bots

> **Standalone example.** This directory is NOT part of the root `pnpm-workspace.yaml`.
> Install and run from this folder independently.

Client, provider, and evaluator bots that autonomously run ERC-8183 escrow jobs on Arc Testnet.

## Architecture

```
Client Bot ──createJob──▶ Provider Bot ──submit──▶ Evaluator Bot ──complete──▶ Done
   │                        │                         │
   ├─ setBudget             ├─ claim                   ├─ evaluate (rules/LLM)
   ├─ approve USDC          ├─ running                 └─ complete tx
   └─ fund                  └─ submit tx
```

Three independent PM2 processes, each with its own wallet + API key.

## 1. Register Agents

Register your three role agents in the external registry:

```bash
# Set env vars for each wallet's private key
export CLIENT_PRIVATE_KEY=0x...
export PROVIDER_PRIVATE_KEY=0x...
export EVALUATOR_PRIVATE_KEY=0x...

cd apps/console
npx tsx scripts/register-erc8183-agents.ts
```

## 2. Generate API Keys

Create role-scoped API keys for each agent:

```bash
npx tsx scripts/create-erc8183-three-agent-keys.ts
```

Each key gets scoped permissions:

| Role   | Scopes                                        |
|--------|-----------------------------------------------|
| client | `erc8183:create`, `erc8183:confirm`, `erc8183:tx` |
| provider | `erc8183:claim`, `erc8183:running`, `erc8183:submit`, `erc8183:tx` |
| evaluator | `erc8183:complete`, `erc8183:tx` |

Copy the raw keys — they are shown once.

## 3. Configure Env

Each bot has its own `.env`:

```bash
cd examples/external-erc8183-bots
cp client-bot/.env.example   client-bot/.env
cp provider-bot/.env.example provider-bot/.env
cp evaluator-bot/.env.example evaluator-bot/.env
```

Fill in:
- `ARCLAYER_API_KEY` — generated from `/register/external-bot` on the deployed console
- `*_PRIVATE_KEY` — wallet private key with USDC + gas
- `*_ADDRESS` — corresponding wallet address
- `WORKER_ID` — **must equal `PROVIDER_AGENT_ID`** (the API key's agentId)

**Never commit filled `.env` files.** A `.gitignore` in this folder already excludes them.

### Key constraint

The **`WORKER_ID` in provider bot `.env` must equal `PROVIDER_AGENT_ID`**. The backend's participant guard checks the API key's `agentId` against `job.workerId` on the `/running` route. If they don't match, you get `participant_mismatch`.

### Contract address override (optional)

The shared `tx-signer.js` has hardcoded Arc Testnet addresses with env override support:

| Env Var | Default | Contract |
|---------|---------|----------|
| `ERC8183_AGENTIC_COMMERCE_ADDRESS` | `0x0747EEf0706327138c69792bF28Cd525089e4583` | AgenticCommerce |
| `USDC_ADDRESS` | `0x3600000000000000000000000000000000000000` | USDC |

Override via any bot's `.env`:

```
ERC8183_AGENTIC_COMMERCE_ADDRESS=0x<new-address>
USDC_ADDRESS=0x<new-address>
```

No source code edit needed. Falls back to defaults if unset.

## 4. Install Dependencies

This example is standalone — install from this folder:

```bash
cd examples/external-erc8183-bots
npm install
```

## 5. Run with PM2

```bash
# Start all three bots
pm2 start client-bot/ecosystem.config.cjs
pm2 start provider-bot/ecosystem.config.cjs
pm2 start evaluator-bot/ecosystem.config.cjs

# Monitor
pm2 status
pm2 logs arclayer-erc8183-provider --lines 20
```

The bots work independently:
- **Client** creates + funds a job every `JOB_CREATE_INTERVAL_MS` (default 60s)
- **Provider** polls every `JOB_POLL_INTERVAL_MS` (5s) for open/funded jobs
- **Evaluator** polls every `JOB_POLL_INTERVAL_MS` (5s) for submitted jobs

## 6. Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `participant_mismatch` | API key agentId doesn't match job participant | Ensure `WORKER_ID == PROVIDER_AGENT_ID` in provider `.env` |
| `erc8183_job_not_funded` | Job hasn't been funded on-chain | Wait for client bot to complete the fund cycle |
| `erc8183_job_not_claimed` | Provider tries to markRunning before claim | Provider handles this automatically in Phase 2 |
| `insufficient_balance` | Wallet out of USDC | Top up wallet via Arc Testnet faucet |
| Request timeout on RPC | Free tier rate limit | Retry or use a different RPC endpoint |

## 7. Security Notes

- **Never commit `.env` files.** This folder includes a `.gitignore` that excludes them. Use `.env.example` as template.
- Each bot has its own API key scoped to only the actions it needs.
- API key is sent via `Authorization: Bearer` header.
- Wallet private keys never leave the bot process.
- `AUTONOMOUS_TX=true` is required — the bot signs + broadcasts its own txs.

## 8. Safety Guards

| Env Var | Default | Description |
|---------|---------|-------------|
| `MAX_JOBS_PER_RUN` | 1 | Client | Stop after N total jobs. Set `0` only for unlimited recurring creation — dangerous for first run |
| `MAX_OPEN_JOBS` | 5 | Client | Skip creation if too many open jobs |
| `MAX_ACTIVE_JOBS` | 3 | Provider/evaluator — process at most N per cycle |
| `MAX_BUDGET_ATOMIC` | — | Client — cap per-job budget (hardcoded in env) |
| `AUTONOMOUS_TX` | true | Required — enables on-chain signing |

## 9. Production Checklist

- [ ] Register all 3 agents in external registry
- [ ] Generate role-scoped API keys (client/provider/evaluator)
- [ ] Fund wallets with USDC + ARC gas tokens
- [ ] Set `AUTONOMOUS_TX=true` in all `.env`
- [ ] Verify `WORKER_ID == PROVIDER_AGENT_ID` in provider `.env`
- [ ] Test one full cycle manually
- [ ] Deploy with PM2 ecosystem configs
- [ ] Monitor logs for errors
- [ ] Set `MAX_JOBS_PER_RUN` for controlled testing
