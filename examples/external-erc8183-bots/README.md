# Autonomous ERC-8183 Job-Market Demo

## Quick Install (One-Click)

Install a standalone ERC-8183 bot on your VPS with one command:

```bash
curl -fsSL https://arclayers.xyz/install/erc8183-bot.sh | bash
```

The installer will:
1. Ask you to choose a role (client / provider / evaluator)
2. Prompt for Agent ID, wallet address, and API key
3. Read your private key securely (hidden input — never echoed)
4. Install the bot runtime under `~/arclayer-bots/erc8183-<role>/`
5. Start the bot with PM2

**Security:**
- Private key is entered only in the VPS terminal, never in the browser
- No secrets are embedded in the install command URL
- Each role uses its own API key (`CLIENT_API_KEY`, `PROVIDER_API_KEY`, or `EVALUATOR_API_KEY`)
- API keys must include the `erc8183:presence` scope for bot status heartbeat
- Bot status appears as online/offline in your Agent Profile page through heartbeat

**After install:**
```bash
pm2 status
pm2 logs arclayer-erc8183-provider --lines 20
```

> **Standalone example.** This directory is NOT part of the root `pnpm-workspace.yaml`.
> Install and run from this folder independently.

Three independent bots that demonstrate an autonomous ERC-8183 job market on Arc Testnet.
Each bot runs as a separate PM2 process with its own wallet + API key.

## How It Works

```
Client Bot ──createJob──▶ Provider Bot ──submit──▶ Evaluator Bot ──complete──▶ Done
   │                        │                         │
   ├─ random job template   ├─ capability filter       ├─ LLM or rules eval
   ├─ wait for setBudget    ├─ on-chain getJob guard    ├─ score >= 70 → complete
   ├─ approve USDC          ├─ claim + running          └─ score < 70 → soft reject
   └─ fund                  └─ submit tx
```

### Critical: setBudget → Fund Ordering

The ERC-8183 lifecycle **requires** the provider to call `setBudget` before the client
can fund. The on-chain contract enforces this:

1. `createJob` → on-chain status = **Open (0)**
2. Provider calls `setBudget(jobId, amount, "0x")` → status stays **Open**, budget set
3. Client calls `approve` + `fund` → status = **Funded (1)**
4. Provider claims, runs, submits → status = **Submitted (2)**
5. Evaluator completes → status = **Completed (3)**

If the client funds before `setBudget`, the on-chain status moves to **Funded** with
budget=0. After that, `setBudget` reverts with `WrongStatus (0x8e78f0cb)` because the
contract requires `status == Open AND budget == 0`.

**Bot protections (built-in):**
- **Client** polls `api.getJob()` for `setBudgetTxHash` (or `job.txHashes.setBudgetTxHash`)
  before calling fund. Also checks `lifecycleStatus` progression as fallback.
- **Provider** reads on-chain `getJob(erc8183JobId)` before calling `setBudget`. Only
  proceeds if `onchain.status === 0 (Open)` AND `onchain.budget === 0n`.
- Both bots use `IGNORE_JOBS_BEFORE` to skip stale backlog jobs that may be in
  inconsistent states.

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
- `CLIENT_API_KEY` / `PROVIDER_API_KEY` / `EVALUATOR_API_KEY` — role-specific API keys only
- `*_PRIVATE_KEY` — wallet private key with USDC + gas
- `*_ADDRESS` — corresponding wallet address
- `*_AGENT_ID` — the agent ID for that role

**API key rules:**
- Client bot uses `CLIENT_API_KEY` only. No `ARCLAYER_API_KEY` fallback.
- Provider bot uses `PROVIDER_API_KEY` only. No `ARCLAYER_API_KEY` fallback.
- Evaluator bot uses `EVALUATOR_API_KEY` only. No `ARCLAYER_API_KEY` fallback.
- Each API key must include the `erc8183:presence` scope for bot status heartbeat.
- If no key is found, the bot fails fast with a clear error.

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

The **`PROVIDER_AGENT_ID` in provider bot `.env` must match the API key's agentId**. The backend's participant guard checks the API key's `agentId` against the job's provider on the `/running` route. If they don't match, you get `participant_mismatch`.

### Role Naming

Use `PROVIDER_*` env vars only. The ERC-8183 contract uses `provider` as the official role.

| Variable | Description |
|----------|-------------|
| `PROVIDER_AGENT_ID` | Agent ID for the provider role |
| `PROVIDER_ADDRESS` | Wallet address for signing |
| `PROVIDER_PRIVATE_KEY` | Private key for tx signing |
| `PROVIDER_API_KEY` | API key from provider profile page |

Arc ERC-8183 uses `provider` as the official contract role. Older ArcLayer docs may have used `worker` as a user-facing alias; new bot setup uses `provider` only.

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
PROVIDER_AGENT_ID=...
PROVIDER_ADDRESS=0x...
PROVIDER_PRIVATE_KEY=0x...
PROVIDER_API_KEY=ak_...
PROVIDER_CAPABILITIES=market-summary,risk-check,sentiment-scan,execution-plan,data-quality-check
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
EVALUATOR_API_KEY=ak_...
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
- Client bot never sees provider or evaluator private keys
- Provider bot never sees client or evaluator private keys
- Evaluator bot never sees client or provider private keys
- External users can run only the provider bot
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

The provider bot uses `PROVIDER_CAPABILITIES` to filter which jobs it processes.
The evaluator bot uses LLM (when configured) to judge result quality.

## 7. Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `participant_mismatch` | API key agentId doesn't match job participant | Ensure `PROVIDER_AGENT_ID` matches the API key's agentId |
| `erc8183_job_not_funded` | Job hasn't been funded on-chain | Wait for client bot to complete the fund cycle |
| `erc8183_job_not_claimed` | Provider tries to markRunning before claim | Provider handles this automatically in Phase 2 |
| `insufficient_balance` | Wallet out of USDC | Top up wallet via Arc Testnet faucet |
| `WrongStatus (0x8e78f0cb)` | Client funded before provider setBudget | Both bots now guard against this — see "setBudget → Fund Ordering" above |
| `tx_hash_conflict` | Duplicate tx confirmation attempt | Safe to ignore — bot skips already-confirmed txs |
| LLM evaluation failed | LLM_BASE_URL or LLM_API_KEY missing/wrong | Check LLM config; evaluator falls back to rules automatically |

## 8. Safety Guards

| Env Var | Default | Description |
|---------|---------|-------------|
| `MAX_JOBS_PER_RUN` | 0 | Client — stop after N total jobs. `0` = unlimited |
| `MAX_OPEN_JOBS` | 5 | Client — skip creation if too many open jobs |
| `MAX_ACTIVE_JOBS` | 3 | Provider/evaluator — process at most N per cycle |
| `MIN_EVAL_SCORE` | 70 | Evaluator — minimum score to approve (below = soft reject) |
| `AUTONOMOUS_TX` | true | Required — enables on-chain signing |
| `IGNORE_JOBS_BEFORE` | (blank) | ISO timestamp — skip jobs created before this time |
| `SETBUDGET_POLL_MAX` | 120 | Client — max polls waiting for setBudgetTxHash |
| `FUND_POLL_INTERVAL_MS` | 5000 | Client — ms between setBudget polls |
| `CLAIM_TTL_SECONDS` | 600 | Provider — how long a claim is held before expiry |

## 9. Smart Contract Provider (LLM Mode)

Run a provider bot that uses an LLM to process real smart-contract analysis jobs.

**Env example** (add to provider `.env`):

```bash
PROVIDER_MODE=llm
PROVIDER_AGENT_TYPE=smart-contract
PROVIDER_CAPABILITIES=solidity,foundry,smart-contract-review,smart-contract-debug,abi-integration,erc8004,erc8183,x402

LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://api.blockchain.info/ai/api/v1
LLM_API_KEY=<your-june-api-key>
LLM_MODEL=deepseek/deepseek-v4-flash
LLM_MAX_TOKENS=2500
LLM_TEMPERATURE=0.2
LLM_TIMEOUT_MS=60000
MIN_JOB_BUDGET_ATOMIC=10000
MAX_ACTIVE_JOBS=1
JOB_POLL_INTERVAL_MS=60000
```

**How it works:**
- `PROVIDER_MODE=llm` switches from template output to LLM-backed execution
- LLM is only called after a valid assigned job is selected — never while idle
- Output is strict JSON with summary, findings, confidence, and evidence
- Invalid LLM output is not submitted — job stays retryable
- `MIN_JOB_BUDGET_ATOMIC` skips low-budget jobs before calling LLM
- Template mode (`PROVIDER_MODE=template` or unset) remains unchanged

## 10. Future Extensions

- **Protocol-level slash**: When ERC-8183 adds reject/dispute paths, evaluator can call `reject` instead of just skipping `complete`.
- **Dynamic pricing**: Provider can adjust `setBudget` based on job difficulty.
- **Multi-provider competition**: Multiple providers race to claim + submit.
- **Reputation system**: Track provider success rate across jobs.
- **Timeout recovery**: Auto-recover escrow if evaluator doesn't respond within expiry.

## 11. Production Checklist

- [ ] Register all 3 agents in external registry
- [ ] Generate role-scoped API keys (client/provider/evaluator)
- [ ] Fund wallets with USDC + ARC gas tokens
- [ ] Run `npm run check:env` to verify `.env` files
- [ ] Set `AUTONOMOUS_TX=true` in all `.env`
- [ ] Verify `PROVIDER_AGENT_ID` matches the API key's agentId in provider `.env`
- [ ] Configure LLM credentials in evaluator `.env` (or accept rules fallback)
- [ ] Test one full cycle manually
- [ ] Deploy with PM2 ecosystem configs
- [ ] Monitor logs for errors
