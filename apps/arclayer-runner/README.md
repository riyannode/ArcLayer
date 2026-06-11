# ArcLayer Runner

Execution guard for external LLM runtimes (Hermes, OpenClaw, custom).

Runner is the policy boundary. LLM runtimes request actions. Runner validates, enforces policy, executes, stores proof, and returns structured results.

## Architecture

```text
Hermes / OpenClaw / Any LLM Runtime
  → ArcLayer Runner (auth + policy + audit)
  → ArcLayer MCP Server (existing /api/mcp — identity, jobs, lifecycle)
  → Circle CLI (wallet, x402 payments, balance)
  → Arc Testnet (ERC-8004 identity, ERC-8183 settlement)
```

Runner does NOT replace the existing MCP stack. It wraps it with:
- Bearer token auth on all sensitive endpoints
- Persistent spending ledger (survives restarts)
- Per-tx / daily / monthly payment limits
- Idempotent x402 payments
- JSONL receipt/proof store
- Circle CLI allowlisting (no raw shell, no wallet import/sign)

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

All sensitive routes require `Authorization: Bearer <ARCLAYER_RUNNER_SECRET>`.

Public routes (no auth):
- `GET /health`
- `GET /.well-known/arclayer-agent.json`
- `GET /skills/arclayer-global`

Protected routes (auth required):
- `POST /runtime/run`
- `POST /erc8004/prepare-register`
- `POST /erc8183/provider/run`
- `POST /x402/inspect`
- `POST /x402/pay`
- `POST /x402/batch-pay`
- `GET /circle/status`
- `GET /receipts`
- `GET /ledger`

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

Hermes/OpenClaw must expose a local gateway endpoint compatible with this contract.

## Circle CLI Preflight

```bash
node apps/arclayer-runner/dist/index.js doctor
```

Checks:
- Circle CLI binary in PATH
- `circle --version` works
- `circle wallet status --type agent` works
- Configured wallet address exists
- Gateway balance query works
- Global Skill file found
- Runtime endpoint reachable
- Runner secret configured (16+ chars)

## Payment Policy

Spending limits are computed from persistent JSONL ledger, not in-memory counters.

- `ARCLAYER_PER_TX_LIMIT_USDC` — max per single payment
- `ARCLAYER_DAILY_LIMIT_USDC` — max per calendar day (UTC)
- `ARCLAYER_MONTHLY_LIMIT_USDC` — max per calendar month (UTC)
- `ARCLAYER_BATCH_MAX_ITEMS` — max items in batch payment
- `ARCLAYER_BATCH_MAX_TOTAL_USDC` — max total for batch

All x402 payments require or auto-generate `idempotencyKey`.
Same key cannot double-pay.

## MCP Bridge

Runner delegates to the existing ArcLayer MCP server for:
- `identity.prepare_register_agent` — ERC-8004 registration calldata
- `provider.runtime_*` — job lifecycle state tracking
- `jobs.list_public` / `jobs.get_public` — job discovery

Configure with:
- `ARCLAYER_MCP_BASE_URL` — MCP server URL (default: runtime endpoint)
- `ARCLAYER_MCP_TOKEN` — MCP session token

## Receipts & Proof

All operations produce JSONL receipts in `ARCLAYER_RUNNER_DATA_DIR/receipts.jsonl`.

Receipt types:
- `runtime_result` — LLM runtime dispatch
- `erc8183_submit` — ERC-8183 deliverable submission
- `x402_payment` — x402 payment
- `policy_reject` — policy enforcement rejection
- `circle_status` — Circle CLI status check

## Circle CLI Adapter (Allowlisted)

Allowed:
- `circle --version`
- `circle wallet status --type agent`
- `circle wallet balance`
- `circle wallet limit budget`
- `circle gateway balance`
- `circle services inspect`
- `circle services pay`
- `circle wallet execute submit(uint256,bytes32,bytes)` (ERC-8183 only)
- `circle wallet execute register(string)` (only with explicit `allowRegister`)

Blocked:
- `wallet import`
- `wallet sign`
- `gateway withdraw`
- `transaction cancel/accelerate`
- Unrestricted `wallet execute` (no `--contract`)
- Any non-allowlisted contract method

## Known Limitations

- v1 is provider-only (evaluator/client roles rejected)
- ERC-8004 registration is prepare-only by default
- Daily/monthly limits reset on ledger file corruption (JSONL append-only)
- Circle CLI must be installed separately (not Runner's job)
- Runtime must expose `/run` endpoint (configurable path)
