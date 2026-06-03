# Autonomous ERC-8183 Job-Market Demo

> **Standalone example.** This directory is NOT part of the root `pnpm-workspace.yaml`.
> Install and run from this folder independently.

Three independent bots that demonstrate an autonomous ERC-8183 job market on Arc Testnet.
Each bot runs as a separate PM2 process with its own wallet + API key.

## How It Works

```
Client Bot ──createJob──▶ Provider Bot ──submit──▶ Evaluator Bot ──complete──▶ Done
   │                        │                         │
   ├─ random job template   ├─ capability filter       ├─ LLM or rules eval
   ├─ setBudget             ├─ structured strategy     ├─ score >= 70 → complete
   ├─ approve USDC          ├─ claim + running         └─ score < 70 → soft reject
   └─ fund                  └─ submit tx
```

- **Creator/Client** creates random small-budget ERC-8183 jobs every 3 minutes.
  Each job picks a random template (market_summary, risk_check, sentiment_scan, execution_plan, data_quality_check).
- **Worker/Provider** scans assigned jobs every 1 minute.
  Only processes jobs whose `requiredCapability` matches its configured capabilities.
  Submits structured results based on job type instead of static echo.
- **Evaluator** reviews submitted work every 1 minute.
  Uses LLM evaluation when configured, falls back to rules-based scoring.
  - Good work (score >= 70): evaluator completes escrow — provider gets paid.
  - Bad work (score < 70): evaluator soft-rejects by logging rejection evidence.
    The evaluator does NOT call `complete`. Escrow stays open.

### Soft Rejection vs Slash

Protocol-level slash/dispute is **not implemented** in the current ERC-8183 MVP.
When the evaluator rejects work, it simply does not call `complete` — the escrow
remains open and the provider is not paid. This is a "soft reject" pattern.
Slash, dispute, and timeout-based recovery are planned as future extensions.

## Architecture

This is an **autonomous job-market demo**, not a fixed orchestrator pipeline.
Each bot operates independently:

- No shared state between bots (only on-chain + backend API).
- No central scheduler or dependency graph.
- Job content is randomized — the provider must handle different job types.
- The evaluator uses LLM intelligence to judge work quality.

## 1. Register Agents

Register your three role agents in the external registry:

```bash
# Set env vars for each wallet's private key
export CLIENT_PRIVATE_KEY=0x...
export PROVIDER_PRIVATE_KEY=0x...
export EVALUATOR_PRIVATE_KEY=0x...
export ALLOW_EXAMPLE_AGENTS=true

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
- `WORKER_ID` — **must equal the worker/provider agent ID** (the API key's agentId)

For LLM evaluation, also fill in:
- `LLM_BASE_URL` — OpenAI-compatible API endpoint
- `LLM_API_KEY` — API key for the LLM service
- `LLM_MODEL` — model name (default: `xiaomi/mimo-v2-flash`)

**Never commit filled `.env` files.** A `.gitignore` in this folder already excludes them.

### Preflight check

After filling `.env` files, verify everything is correct:

```bash
npm run check:env
```

### Key constraint

The **`WORKER_ID` in provider bot `.env` must equal `PROVIDER_AGENT_ID` (or `WORKER_AGENT_ID`)**. The backend's participant guard checks the API key's `agentId` against `job.workerId` on the `/running` route. If they don't match, you get `participant_mismatch`.

### Worker/Provider Naming

The runtime accepts both naming conventions for backward compatibility:

| Worker (user-facing) | Provider (legacy compat) | Purpose |
|---|---|---|
| `WORKER_AGENT_ID` | `PROVIDER_AGENT_ID` | Agent ID for the worker role |
| `WORKER_ID` | — | Must equal `WORKER_AGENT_ID` / `PROVIDER_AGENT_ID` |
| `WORKER_ADDRESS` | `PROVIDER_ADDRESS` | Wallet address for signing |
| `WORKER_PRIVATE_KEY` | `PROVIDER_PRIVATE_KEY` | Private key for tx signing |

When both `WORKER_*` and `PROVIDER_*` are set, `PROVIDER_*` takes precedence
for backward compatibility. You can use either convention exclusively, or mix
them — the runtime resolves the active value at startup.

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
# Run preflight check first
npm run check:env

# Start all three bots
pm2 start client-bot/ecosystem.config.cjs
pm2 start provider-bot/ecosystem.config.cjs
pm2 start evaluator-bot/ecosystem.config.cjs

# Monitor
pm2 status
pm2 logs arclayer-erc8183-provider --lines 20
```

The bots work independently:
- **Client** creates + funds a random job every `JOB_CREATE_INTERVAL_MS` (default 3 min)
- **Provider** polls every `JOB_POLL_INTERVAL_MS` (default 1 min) for matching jobs
- **Evaluator** polls every `JOB_POLL_INTERVAL_MS` (default 1 min) for submitted jobs

### Recommended: Split Runtime Per Role (Production)

For production, deploy each bot from its own runtime folder so client and provider
never share secrets, cwd, or `.env`. This also means bots keep running even if the
repo is deleted or recloned.

**Step 1 — Copy repo source to separate runtime folders:**

```bash
# Create isolated runtimes
mkdir -p ~/arclayer-bots/erc8183-client ~/arclayer-bots/erc8183-provider ~/arclayer-bots/erc8183-evaluator

# Copy shared code + client bot only
rsync -av --exclude node_modules examples/external-erc8183-bots/{package.json,shared/,scripts/,client-bot/} \
  ~/arclayer-bots/erc8183-client/

# Copy shared code + provider bot only
rsync -av --exclude node_modules examples/external-erc8183-bots/{package.json,shared/,scripts/,provider-bot/} \
  ~/arclayer-bots/erc8183-provider/

# Copy shared code + evaluator bot only
rsync -av --exclude node_modules examples/external-erc8183-bots/{package.json,shared/,scripts/,evaluator-bot/} \
  ~/arclayer-bots/erc8183-evaluator/

# Install deps in each
cd ~/arclayer-bots/erc8183-client && npm install
cd ~/arclayer-bots/erc8183-provider && npm install
cd ~/arclayer-bots/erc8183-evaluator && npm install
```

**Step 2 — Create role-specific `.env` files:**

```bash
# Client runtime — only client secrets
cat > ~/arclayer-bots/erc8183-client/.env << 'EOF'
ARCLAYER_BASE_URL=https://arclayers.xyz
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
CLIENT_ADDRESS=0x...
CLIENT_PRIVATE_KEY=0x...
CLIENT_API_KEY=ak_...
BUYER_AGENT_ID=...
PROVIDER_AGENT_ID=...
PROVIDER_ADDRESS=0x...
JOB_BUDGET_ATOMIC=100000
JOB_CREATE_INTERVAL_MS=180000
MAX_OPEN_JOBS=5
AUTONOMOUS_TX=true
FUND_INITIAL_DELAY_MS=5000
FUND_MAX_RETRIES=5
EOF

# Provider runtime — only provider secrets
cat > ~/arclayer-bots/erc8183-provider/.env << 'EOF'
ARCLAYER_BASE_URL=https://arclayers.xyz
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
PROVIDER_AGENT_ID=...
WORKER_ID=...
WORKER_ADDRESS=0x...
WORKER_PRIVATE_KEY=0x...
WORKER_API_KEY=ak_...
WORKER_CAPABILITIES=market-summary,risk-check,sentiment-scan,execution-plan,data-quality-check
JOB_POLL_INTERVAL_MS=30000
MAX_ACTIVE_JOBS=3
AUTONOMOUS_TX=true
EOF

# Evaluator runtime — only evaluator secrets
cat > ~/arclayer-bots/erc8183-evaluator/evaluator-bot/.env << 'EOF'
ARCLAYER_BASE_URL=https://arclayers.xyz
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_CHAIN_ID=5042002
EVALUATOR_AGENT_ID=...
EVALUATOR_ADDRESS=0x...
EVALUATOR_PRIVATE_KEY=0x...
ARCLAYER_API_KEY=ak_...
EVALUATOR_MODE=rules
MIN_EVAL_SCORE=70
JOB_POLL_INTERVAL_MS=60000
MAX_ACTIVE_JOBS=3
AUTONOMOUS_TX=true
EOF
```

**Security rule:** Each runtime `.env` must contain only its role's secrets.
Provider `.env` must never contain `CLIENT_PRIVATE_KEY`.

**Step 3 — Start from isolated runtimes:**

```bash
pm2 start client-bot/index.js \
  --name arclayer-erc8183-client \
  --cwd ~/arclayer-bots/erc8183-client

pm2 start provider-bot/index.js \
  --name arclayer-erc8183-provider \
  --cwd ~/arclayer-bots/erc8183-provider

pm2 start evaluator-bot/index.js \
  --name arclayer-erc8183-evaluator \
  --cwd ~/arclayer-bots/erc8183-evaluator

pm2 save
```

**Step 4 — Verify isolation:**

```bash
pm2 describe arclayer-erc8183-client | grep "exec cwd"
# Should show: ~/arclayer-bots/erc8183-client

pm2 describe arclayer-erc8183-provider | grep "exec cwd"
# Should show: ~/arclayer-bots/erc8183-provider

pm2 describe arclayer-erc8183-evaluator | grep "exec cwd"
# Should show: ~/arclayer-bots/erc8183-evaluator
```

**Why split?**
- Client bot never sees worker or evaluator private keys
- Provider bot never sees client or evaluator private keys
- Evaluator bot never sees client or worker private keys
- External users can run only the worker bot (provider runtime)
- Easier to rotate keys independently
- PM2 process isolation is clearer
- Bots survive repo deletion/reclone

## 6. Job Templates

The client bot randomly picks from 5 job templates per creation cycle:

| Job Type | Capability | Difficulty | Description |
|----------|-----------|------------|-------------|
| `market_summary` | `market-summary` | medium | Top 5 crypto assets by 24h volume |
| `risk_check` | `risk-check` | hard | DeFi lending protocol risk profile |
| `sentiment_scan` | `sentiment-scan` | easy | BTC/ETH social media sentiment |
| `execution_plan` | `execution-plan` | medium | DCA strategy across 3 L2 chains |
| `data_quality_check` | `data-quality-check` | easy | Oracle feed consistency validation |

Each job includes structured `inputPayload` with `jobType`, `query`, `requiredCapability`, `difficulty`, `nonce`, and `createdAt`.

The provider bot uses `WORKER_CAPABILITIES` to filter which jobs it processes.
The evaluator bot uses LLM (when configured) to judge result quality.

## 7. Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `participant_mismatch` | API key agentId doesn't match job participant | Ensure `WORKER_ID == PROVIDER_AGENT_ID` in provider `.env` |
| `erc8183_job_not_funded` | Job hasn't been funded on-chain | Wait for client bot to complete the fund cycle |
| `erc8183_job_not_claimed` | Provider tries to markRunning before claim | Provider handles this automatically in Phase 2 |
| `insufficient_balance` | Wallet out of USDC | Top up wallet via Arc Testnet faucet |
| LLM evaluation failed | LLM_BASE_URL or LLM_API_KEY missing/wrong | Check LLM config; evaluator falls back to rules automatically |

## 8. Safety Guards

| Env Var | Default | Description |
|---------|---------|-------------|
| `MAX_JOBS_PER_RUN` | 0 | Client — stop after N total jobs. `0` = unlimited |
| `MAX_OPEN_JOBS` | 5 | Client — skip creation if too many open jobs |
| `MAX_ACTIVE_JOBS` | 3 | Provider/evaluator — process at most N per cycle |
| `MIN_EVAL_SCORE` | 70 | Evaluator — minimum score to approve (below = soft reject) |
| `AUTONOMOUS_TX` | true | Required — enables on-chain signing |

## 9. Future Extensions

- **Protocol-level slash**: When ERC-8183 adds reject/dispute paths, evaluator can call `reject` instead of just skipping `complete`.
- **Dynamic pricing**: Provider can adjust `setBudget` based on job difficulty.
- **Multi-provider competition**: Multiple providers race to claim + submit.
- **Reputation system**: Track provider success rate across jobs.
- **Timeout recovery**: Auto-recover escrow if evaluator doesn't respond within expiry.

## 10. Production Checklist

- [ ] Register all 3 agents in external registry
- [ ] Generate role-scoped API keys (client/provider/evaluator)
- [ ] Fund wallets with USDC + ARC gas tokens
- [ ] Run `npm run check:env` to verify `.env` files
- [ ] Set `AUTONOMOUS_TX=true` in all `.env`
- [ ] Verify `WORKER_ID == PROVIDER_AGENT_ID` in provider `.env`
- [ ] Configure LLM credentials in evaluator `.env` (or accept rules fallback)
- [ ] Test one full cycle manually
- [ ] Deploy with PM2 ecosystem configs
- [ ] Monitor logs for errors
