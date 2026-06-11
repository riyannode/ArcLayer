# ArcLayer Runner

Execution guard for external LLM runtimes (Hermes, OpenClaw, custom).

Runner is the policy boundary. LLM runtimes request actions. Runner validates, enforces policy, executes, stores proof, and returns structured results.

## Architecture

```text
Hermes / OpenClaw / Any LLM Runtime
  → ArcLayer Runner (auth + policy + audit)
    → Runner MCP (POST /mcp — local authenticated tools)
    → Console MCP Bridge (/api/mcp — identity, jobs, lifecycle)
    → Circle CLI (wallet, x402 payments, balance)
    → Arc Testnet (ERC-8004 identity, ERC-8183 settlement)
```

## Console MCP vs Runner MCP

**Console MCP** (existing hosted `/api/mcp`):
- Hosted protocol/read/prepare tools
- No local Circle CLI execution
- No external user wallet session
- Tools: `identity.*`, `jobs.*`, `provider.runtime_*`, `evaluator.prepare_*`

**Runner MCP** (local authenticated `POST /mcp`):
- Local authenticated execution tools
- Circle CLI adapter
- x402 pay/batch-pay with idempotency
- ERC-8183 provider submit
- Receipt/proof storage
- Policy enforcement (spending limits, host allowlist)
- Tools: `runner.*`, `circle.*`, `x402.*`, `erc8004.*`, `erc8183.*`

Both interfaces call the same Runner guard/policy/execution services.

## Quick Start

```bash
# 1. Build dependencies (order matters)
corepack pnpm --filter @arclayer/sdk build
corepack pnpm --filter @arclayer/runner-core build
corepack pnpm --filter @arclayer/circle-cli-adapter build
corepack pnpm --filter @arclayer/runner build

# 2. Configure
cp apps/arclayer-runner/.env.example apps/arclayer-runner/.env
# Edit .env with real values

# 3. Doctor check
node apps/arclayer-runner/dist/index.js doctor

# 4. Start
node apps/arclayer-runner/dist/index.js start
```

## PM2

```bash
cd apps/arclayer-runner
pm2 start ecosystem.config.cjs
pm2 logs arclayer-runner
```

## Auth

Default-deny: all routes require `Authorization: Bearer <ARCLAYER_RUNNER_SECRET>` except:

Public routes (no auth):
- `GET /health`
- `GET /.well-known/arclayer-agent.json`
- `GET /skills/arclayer-global`

Everything else — including `/mcp`, `/x402/pay`, `/receipts`, and any future routes — requires auth.

## Runner MCP

Use Runner MCP for MCP-capable clients. JSON-RPC 2.0 over HTTP.

```bash
# List available tools
curl -X POST http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer $ARCLAYER_RUNNER_SECRET" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}'

# Health check
curl -X POST http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer $ARCLAYER_RUNNER_SECRET" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"2","method":"tools/call","params":{"name":"runner.health","arguments":{}}}'

# Pay x402 service
curl -X POST http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer $ARCLAYER_RUNNER_SECRET" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"3","method":"tools/call","params":{"name":"x402.pay","arguments":{"url":"https://api.example.com/data","maxAmountUsdc":"0.005","reason":"weather data"}}}'

# Run ERC-8183 provider job
curl -X POST http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer $ARCLAYER_RUNNER_SECRET" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"4","method":"tools/call","params":{"name":"erc8183.provider_run_and_submit","arguments":{"taskId":"t1","jobId":"42","agentId":"your-agent","provider":"0x...","description":"analyze data","input":{"prompt":"do work"}}}}'
```

### Runner MCP Tools

**runner.\*** — Introspection:
- `runner.health` — Health check
- `runner.manifest` — Runner manifest + capabilities
- `runner.skill` — Global Agent Skill content
- `runner.receipts` — Recent receipts
- `runner.ledger` — Spending ledger records
- `runner.policy` — Current spending policy

**circle.\*** — Wallet operations:
- `circle.status` — CLI version + wallet + gateway
- `circle.gateway_balance` — Gateway balance
- `circle.wallet_balance` — Wallet balance
- `circle.wallet_budget` — Wallet budget limit

**x402.\*** — Payments:
- `x402.inspect` — Inspect service (read-only, no payment required)
- `x402.pay` — Pay service (requires paymentEnabled + wallet)
- `x402.batch_pay` — Batch pay (deterministic idempotency keys)
- `x402.list_receipts` — List payment receipts
- `x402.payment_policy` — Current payment limits

**erc8004.\*** — Identity:
- `erc8004.prepare_register` — Prepare registration calldata

**erc8183.\*** — Provider lifecycle:
- `erc8183.provider_run_job` — Dispatch to runtime (no submit)
- `erc8183.provider_submit_deliverable` — Submit on-chain
- `erc8183.provider_run_and_submit` — Full lifecycle
- `erc8183.provider_runtime_status` — Runtime context from Console MCP

## Runtime Gateway Contract

Runner dispatches tasks to LLM runtime via configurable path.

**Request** (POST to `ARCLAYER_RUNTIME_RUN_PATH`, default `/run`):

```json
{
  "taskId": "task-1",
  "protocol": "erc8183",
  "role": "provider",
  "agentId": "agent-id",
  "input": {},
  "metadata": {}
}
```

**Response** (from runtime):

```json
{
  "ok": true,
  "status": "completed",
  "output": {},
  "artifacts": [],
  "paymentRequests": [],
  "actionRequests": []
}
```

## Payment Policy

Spending limits computed from persistent JSONL ledger (event-sourced, append-only).

- `ARCLAYER_PER_TX_LIMIT_USDC` — max per single payment
- `ARCLAYER_DAILY_LIMIT_USDC` — max per calendar day (UTC)
- `ARCLAYER_MONTHLY_LIMIT_USDC` — max per calendar month (UTC)
- `ARCLAYER_BATCH_MAX_ITEMS` — max items in batch
- `ARCLAYER_BATCH_MAX_TOTAL_USDC` — max total for batch

Idempotency: same key → returns existing receipt (no double-pay).
Concurrent same-key → returns 409 PAYMENT_IN_PROGRESS.

## Receipts & Proof

Append-only JSONL in `ARCLAYER_RUNNER_DATA_DIR/receipts.jsonl`.

Receipt types:
- `runtime_result` — LLM runtime dispatch
- `erc8183_submit` — ERC-8183 deliverable submission
- `erc8004_prepare_register` — ERC-8004 registration preparation
- `x402_payment` — x402 payment
- `policy_reject` — policy enforcement rejection
- `circle_status` — Circle CLI status check

NOTE: JSONL is local single-runner storage, not multi-process DB.

## Circle CLI Adapter (Allowlisted)

Allowed:
- `circle --version`, `wallet status`, `wallet balance`, `wallet limit budget`
- `gateway balance`, `services inspect`, `services pay`
- `wallet execute submit(uint256,bytes32,bytes)` (ERC-8183 only)
- `wallet execute register(string)` (only with explicit `allowRegister`)

Blocked:
- `wallet import`, `wallet sign`, `gateway withdraw`
- `transaction cancel/accelerate`
- Unrestricted `wallet execute` (no `--contract`)
- Any non-allowlisted contract method

## Known Limitations

- v1 is provider-only (evaluator/client roles rejected)
- ERC-8004 registration is prepare-only by default
- Circle CLI must be installed separately
- Runtime must expose `/run` endpoint (configurable path)
- Per-process in-memory idempotency lock (not cross-process)
