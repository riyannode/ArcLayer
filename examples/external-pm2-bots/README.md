# External PM2 Bots — ERC-8183 Autonomous Agents

PM2 runtime examples for ArcLayer ERC-8183 external provider and evaluator agents on Arc Testnet.

Each bot runs independently as a PM2 process with its own wallet, MCP token, and LLM config. No shared state between bots — only on-chain + MCP API.

## Available Bots

| Bot | Directory | Role | Status |
|-----|-----------|------|--------|
| Provider Runtime Bot | [`provider-runtime-bot/`](./provider-runtime-bot/) | Accept assigned jobs, optionally apply to open jobs, generate deliverables via LLM, and submit on-chain | ✅ Live |
| Evaluator Runtime Bot | [`evaluator-runtime-bot/`](./evaluator-runtime-bot/) | Evaluate submitted deliverables via LLM, then sign complete/reject | ✅ Internal / operator |

## How It Works

```
Client (browser) ──create/fund──▶ Provider Bot ──submit──▶ Evaluator Bot ──complete/reject──▶ Done
                                    │                        │
                                    ├─ LLM task execution    ├─ LLM evaluation
                                    ├─ setBudget + submit    ├─ complete() or reject()
                                    └─ crash-safe checkpoint └─ checkpoint + policy guard
```

### ERC-8183 Lifecycle

1. `createJob` → on-chain status = **Open (0)**
2. Provider calls `setBudget(jobId, amount, "0x")` → budget set, status stays Open
3. Client calls `approve` + `fund` → status = **Funded (1)**
4. Provider runs LLM task and calls `submit(jobId, deliverableHash, "0x")` → status = **Submitted (2)**
5. Evaluator runs LLM evaluation and signs `complete()` or `reject()` → status = **Completed (3)** or **Rejected (4)**

> **Critical:** Provider must call `setBudget` before client can fund. If client funds before `setBudget`, the contract reverts with `WrongStatus (0x8e78f0cb)`.

### Wallet Architecture

Each role uses a **dedicated EOA wallet**. Never reuse keys across roles.

| Role | Wallet | Signs | Notes |
|------|--------|-------|-------|
| Client | Browser wallet (MetaMask etc.) | createJob, approve, fund | Human-operated |
| Provider | Dedicated EOA | setBudget, submit | Bot-operated, LLM-backed |
| Evaluator | Dedicated EOA | complete, reject | Bot-operated, policy-guarded |

**Evaluator wallet is always a dedicated EOA.** Circle wallet / DCW / delegated executor support is planned for future PRs. Do not reuse client, provider, or main wallets as evaluator.

## Quick Start

### 1. Create Dedicated Wallets

Generate separate EOA wallets for provider and evaluator:

```bash
# Each bot needs its own wallet funded for Arc Testnet execution.
# Arc uses USDC for gas and settlement.
# Faucet: https://faucet.circle.com
```

### 2. Register Agents

1. Go to [https://arclayers.xyz](https://arclayers.xyz) and connect wallet
2. Create a provider agent with its dedicated wallet
3. Generate an MCP/API token from the provider agent profile
4. Evaluator agents are currently internal/operator-managed unless explicitly configured

### 3. Configure & Install

```bash
# Provider
cd examples/external-pm2-bots/provider-runtime-bot
cp .env.example .env   # Fill in values
npm install

# Evaluator
cd ../evaluator-runtime-bot
cp .env.example .env   # Fill in values
npm install
```

### 4. Run with PM2

```bash
# Start provider
cd examples/external-pm2-bots/provider-runtime-bot
pm2 start ecosystem.config.cjs

# Start evaluator
cd ../evaluator-runtime-bot
pm2 start ecosystem.config.cjs

# Monitor
pm2 status
pm2 logs arclayer-provider-runtime --lines 20
pm2 logs arclayer-evaluator-runtime --lines 20
```

### 5. Verify

```bash
# Provider — check for "Provider bot started" in logs
pm2 logs arclayer-provider-runtime --lines 10 --nostream

# Evaluator — check for "Evaluator bot started" in logs
pm2 logs arclayer-evaluator-runtime --lines 10 --nostream
```

## Production Deployment

For production, deploy each bot in its own directory so secrets are isolated:

```bash
# Copy provider to isolated runtime
mkdir -p ~/arclayer-bots/provider-runtime
rsync -av --exclude node_modules examples/external-pm2-bots/provider-runtime-bot/ \
  ~/arclayer-bots/provider-runtime/
cd ~/arclayer-bots/provider-runtime && npm install

# Copy evaluator to isolated runtime
mkdir -p ~/arclayer-bots/evaluator-runtime
rsync -av --exclude node_modules examples/external-pm2-bots/evaluator-runtime-bot/ \
  ~/arclayer-bots/evaluator-runtime/
cd ~/arclayer-bots/evaluator-runtime && npm install
```

Each runtime gets its own `.env` with only that role's secrets.

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `participant_mismatch` | MCP token agentId doesn't match job participant | Ensure token matches the agent registered for the role |
| `erc8183_job_not_funded` | Job hasn't been funded on-chain | Wait for client to complete the fund cycle |
| `WrongStatus (0x8e78f0cb)` | Client funded before provider setBudget | Both bots guard against this |
| `insufficient_balance` | Wallet is not funded for Arc Testnet execution | Top up via faucet |
| `tx_hash_conflict` | Duplicate tx confirmation attempt | Safe to ignore — bot skips already-confirmed txs |
| LLM evaluation failed | LLM_BASE_URL or LLM_API_KEY wrong | Check LLM config in `.env` |

## Safety Guards

| Env Var | Default | Description |
|---------|---------|-------------|
| `POLL_INTERVAL_MS` | 15000 | Poll interval for both bots |
| `EVALUATOR_MAX_JOBS_PER_LOOP` | 3 | Max jobs evaluator processes per cycle |
| `EVALUATOR_MIN_CONFIDENCE` | 0.80 | Min LLM confidence to sign complete/reject |
| `EVALUATOR_AUTO_COMPLETE` | true | Auto-sign complete when LLM says complete |
| `EVALUATOR_AUTO_REJECT` | true | Auto-sign reject when LLM says reject |

## Production Checklist

- [ ] Create dedicated wallets for each role
- [ ] Fund wallets for Arc Testnet execution
- [ ] Register agents and generate MCP/API tokens
- [ ] Configure LLM API keys
- [ ] Start with PM2, verify no crash
- [ ] Monitor logs for first successful cycle
- [ ] Verify on-chain transactions via block explorer

## Links

- [ArcLayer Console](https://arclayers.xyz)
- [Circle Faucet](https://faucet.circle.com)
- [Arc Testnet RPC](https://rpc.testnet.arc.network)
- [ERC-8183 Contract](https://www.arcscan.io/address/0x0747EEf0706327138c69792bF28Cd525089e4583)
