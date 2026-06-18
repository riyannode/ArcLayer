# Autonomous Provider Live ARC Testnet Validation

Real ARC testnet validation of the full autonomous provider lifecycle.

## Prerequisites

- Autonomous provider installed (via `install-autonomous-provider.sh`)
- All 3 PM2 services running (`arclayer-langchain-runtime`, `arclayer-runner`, `arclayer-provider`)
- ERC-8004 identity confirmed
- ARC testnet USDC in wallet (https://faucet.circle.com)
- An existing ERC-8183 job assigned to your provider wallet

## Usage

```bash
bash scripts/live-test-autonomous-provider-arc.sh \
  --live-arc-testnet \
  --job-id <EXISTING_OPEN_OR_FUNDED_JOB_ID>
```

**This script requires `--live-arc-testnet`.** No dry-run mode exists.

**This script requires `--job-id`.** Mock/static job data is not accepted.

## What It Validates

### Pre-flight Checks

| Check | Requirement |
|-------|-------------|
| `CIRCLE_CHAIN` | Must be `ARC-TESTNET` |
| `ARCLAYER_MCP_TOKEN` | Must be set |
| `CIRCLE_WALLET_ADDRESS` | Must be set |
| `ARCLAYER_RUNNER_SECRET` | Must be set |
| LangChain runtime | `GET /health` returns 200 |
| Runner | `GET /health` returns 200 |
| ERC-8004 identity | Confirmed in `~/.arclayer/runner/identity.json` |
| Wallet balance | Non-zero USDC balance |

### Autonomous Lifecycle (monitored via logs)

The provider worker handles the full lifecycle autonomously:

1. **Detect Open job** — Worker polls `provider.list_assigned_jobs_extended`
2. **Set budget** — Worker calls `services.setBudget()` with decimal amount (not atomic)
3. **Client funds job** — External client funds via ERC-8183 `fund()`
4. **Detect Funded job** — Worker polls for Funded status
5. **Execute runtime** — Worker calls LangChain runtime `POST /run`
6. **Publish deliverable** — Worker publishes via MCP `provider.publish_deliverable`
7. **Submit deliverable** — Worker calls `services.submitProviderDeliverable()`

### Monitoring

```bash
# Provider worker logs
pm2 logs arclayer-provider --lines 100

# Runner logs
pm2 logs arclayer-runner --lines 100

# LangChain runtime logs
pm2 logs arclayer-langchain-runtime --lines 100

# Check job status
curl -s http://127.0.0.1:8787/health

# Identity state
cat ~/.arclayer/runner/identity.json | jq .
```

## Getting a Test Job

To create a test job on ARC testnet, you need a client wallet with USDC:

1. Go to https://arclayers.xyz
2. Connect client wallet
3. Create ERC-8183 job with `provider = YOUR_WALLET_ADDRESS`
4. Copy the job ID
5. Run this script with `--job-id <JOB_ID>`

Or use the Console MCP to create a job programmatically.

## Expected Output

```
[STEP] Validating environment...
  ✅ PASS: CIRCLE_CHAIN=ARC-TESTNET
  ✅ PASS: ARCLAYER_MCP_TOKEN is set
  ✅ PASS: CIRCLE_WALLET_ADDRESS=0xbcbf...
  ✅ PASS: ARCLAYER_RUNNER_SECRET is set

[STEP] Checking services...
  ✅ PASS: LangChain runtime healthy (port 8788)
  ✅ PASS: Runner healthy (port 8787)

[STEP] Checking ERC-8004 identity...
  ✅ PASS: Identity confirmed: tokenId=42

[STEP] Checking wallet balance...

[STEP] Testing with job ID: 123

════════════════════════════════════════════════════════════════
Live ARC Testnet Validation Report
════════════════════════════════════════════════════════════════

Job ID: 123
Chain: ARC-TESTNET
Wallet: 0xbcbf...

Provider worker will autonomously:
  1. Detect Open job → set budget on-chain
  2. Client funds job
  3. Detect Funded job → call LangChain runtime /run
  4. Publish deliverable
  5. Submit deliverable on-chain

════════════════════════════════════════════════════════════════
Pre-flight checks passed. Provider worker is running.
Job lifecycle will proceed autonomously.
════════════════════════════════════════════════════════════════
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `--live-arc-testnet` required | Add the flag — no dry-run mode |
| `--job-id` required | Provide a real job ID — mock data not accepted |
| `CIRCLE_CHAIN must be ARC-TESTNET` | Set chain in `.env.runner` |
| Identity not found | Run `arclayer-runner identity ensure --agent-name ... --auto-register` |
| LangChain runtime not responding | Check `pm2 logs arclayer-langchain-runtime` |
| Runner not responding | Check `pm2 logs arclayer-runner` |
| setBudget double-conversion | Fixed in this PR — decimal amount passed, not atomic |
