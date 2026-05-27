# ArcLayer External PM2 Market Agent Bridge

External PM2 market agent bridge example: external PM2 bots make market decisions while ArcLayer acts as the protocol bridge for identity, x402 access, bridge events, receipts, payload hashes, and proof history on Arc.

This is **not** a generic external LLM demo and not a real trading executor.

## Architecture

**Role-split PM2:** 4 independent processes, one per role.

```
oracle -> market_snapshot
                  |
          analyzer -> resolver_output
                           |
                   evaluator -> evaluation
                                    |
                            executor -> execution_intent + x402 autopay
```

- **oracle-bot.js** fetches ArcLayer raw BTC 15m Polymarket market/orderbook/candles feed and posts `role=oracle` `type=market_snapshot`.
- **analyzer-bot.js** reads the latest oracle `market_snapshot` from the bridge, runs LLM analysis, and posts `role=analyzer` `type=resolver_output`.
- **evaluator-bot.js** reads the analyzer `resolver_output`, evaluates risk, and posts `role=evaluator` `type=evaluation`.
- **executor-bot.js** reads the evaluator `evaluation`, posts a DRY_RUN execution intent with x402 autopay receipt. It never places real trades.

**Key principles:**
- No controller spawns children. No `spawnSync`. No chain mode.
- One role = one PM2 process.
- One role = one manifest.
- One role = one A2A API key.
- ERC-8004 ID is only the identity reference/display, not the `ARCLAYER_AGENT_ID` used by job/bridge API.
- x402 is route-level paid access, not a global gate for every API call.

## Flow

```text
external PM2 bot
  -> raw Polymarket BTC 15m data
  -> LLM analysis
  -> risk evaluation
  -> DRY_RUN decision intent
  -> x402 bridge-access
  -> bridge event + payloadHash + runtimeId
  -> receipt/history
  -> /live-a2a-agent frontend viewer
```

1. Each bot reads/writes to the ArcLayer bridge API using its own `ARCLAYER_AGENT_ID` and `ARCLAYER_API_KEY`.
2. Downstream roles (analyzer, evaluator, executor) read upstream events by **category**, not by local agentId. This allows analyzer to read oracle events from `llm-market-oracle`, evaluator to read analyzer events from `llm-market-analyzer`, etc.
3. ArcLayer stores the bridge event, `payloadHash`, `runtimeId`, category metadata, receipt/history, and x402 unlock status.
4. `/live-a2a-agent` shows the full flow.

## Architecture boundary

- **ArcLayer is the protocol bridge.**
- **Bots run anywhere.**
- **Bots own strategy, local LLM keys, and execution.**
- **ArcLayer handles identity, x402, events, receipts, payload hashes, and history.**

`apps/console` stays the protocol/data layer: raw market data, bridge events, x402, receipts, and viewer surfaces only. It does not include real trade execution, a private-key executor, or hardcoded trading strategy.

## Setup

### Environment files

```bash
cd examples/external-pm2-bots/market-agent-bridge
cp .env.common.example .env.common
cp .env.oracle.example .env.oracle
cp .env.analyzer.example .env.analyzer
cp .env.evaluator.example .env.evaluator
cp .env.executor.example .env.executor
# Fill ARCLAYER_API_KEY per role in each .env.<role> file.
# Generate via: POST /api/a2a/keys (scopes: agent_bridge:write, agent_bridge:receipt)
# Never commit .env.* files — .gitignore is included.
npm install
```

Bot startup loads `.env.common` first, then `.env.<role>` overrides it.

`.env.common` contains shared settings only (base URL, category, interval, x402 defaults).
Role-specific API keys and agent IDs go in each `.env.<role>` file.

There is no `llm-market-agent` fallback. Each role uses its own `ARCLAYER_AGENT_ID` from its env file.

### Start with PM2 (independent mode — 4 processes)

```bash
pm2 delete oracle-bot analyzer-bot evaluator-bot executor-bot 2>/dev/null || true
pm2 start ecosystem.independent.config.cjs
pm2 save
pm2 status
```

Expected:
- PM2 has exactly 4 processes.
- oracle-bot runs forever posting `market_snapshot`.
- analyzer-bot runs forever and waits for oracle `market_snapshot`.
- evaluator-bot runs forever and waits for analyzer `resolver_output`.
- executor-bot runs forever and waits for evaluator `evaluation`.
- No controller spawns children. Each process is independent.

## One-shot smoke (no PM2)

```bash
RUN_FOREVER=false node oracle-bot.js
RUN_FOREVER=false node analyzer-bot.js
RUN_FOREVER=false node evaluator-bot.js
RUN_FOREVER=false node executor-bot.js
```

## Required env for x402 executor lifecycle

- `MARKET_EXECUTION_MODE=DRY_RUN`
- `PROTOCOL_TX_MODE=ARC_TESTNET`
- `X402_AUTOPAY=true`
- `X402_AUTOPAY_REQUIRED=false`
- `X402_SCOPE=external_trace`
- `ARC_RPC_URL`
- `ARCLAYER_BASE_URL`
- `ARCLAYER_API_KEY=<required per role — see .env.<role>>`
- `X402_PAYER_PRIVATE_KEY=<required for real x402 only>`

### Heartbeat auth

The `prediction-market-heartbeat` process posts presence to the dashboard. It needs one of:

- `PREDICTION_AGENT_IDS` + `PREDICTION_AGENT_KEYS` — per-agent keys (recommended)
- `A2A_LIVE_EVENTS_TOKEN` — single global token (simpler)

Generate keys via `POST /api/a2a/keys` with scopes: `agent_bridge:write`, `agent_bridge:receipt`, `live_events:write`, `presence:write`.

Or use the helper script (set private keys as env vars first):

```bash
export ORACLE_AGENT_ID=<your-id> ORACLE_PK=0x...
export ANALYZER_AGENT_ID=<your-id> ANALYZER_PK=0x...
export EVALUATOR_AGENT_ID=<your-id> EVALUATOR_PK=0x...
export EXECUTOR_AGENT_ID=<your-id> EXECUTOR_PK=0x...
node scripts/regen-keys.mjs
```

## Safety

- `.env` is ignored by repo policy; `.env.example` files contain placeholders only.
- `MARKET_EXECUTION_MODE=DRY_RUN` is required. Setting `MARKET_EXECUTION_MODE=REAL` may throw.
- x402 autopay requires: `X402_AUTOPAY=true`, `PROTOCOL_TX_MODE=ARC_TESTNET`, and an unpaid session.
- No LLM API key, private key, exchange key, or wallet private key is sent to ArcLayer or Supabase.
- ArcLayer stores only non-sensitive bridge metadata: `agent_id`, `runtime_id`, `session_id`, `category`, role, event payload hashes, receipts, and timestamps.

## Idempotency & Duplicate Prevention

### One role = one content event per session

Each bot role (analyzer, evaluator, executor) performs its content action
and x402 payment **at most once per session**. This is enforced at three layers:

1. **Bot-side gating** — `hasRoleContentEvent()` in `shared/arclayer-client.js`
   checks if the role already has a content-type event (`resolver_output`,
   `evaluation`, `execution_intent`) for the current session. If found, the bot
   skips processing entirely before posting events or paying.

2. **Server-side content event dedup** — The `agent_bridge_events` table has a
   partial unique index on `event_dedupe_key` (SHA-256 of
   `v1|sessionId|agentId|role|eventType`). Only content events
   (`market_snapshot`, `resolver_output`, `evaluation`, `execution_intent`) get a
   non-null dedupe key. This ensures at most one content event per agent/role/session
   regardless of bot process races.

3. **Server-side payment idempotency** — The `x402_resource_payments` table
   prevents duplicate x402 settlement per resource/session/scope/role key.

### Deterministic nonce

By default, `shared/x402-client.js` generates a deterministic EIP-3009 nonce
for Arc native exact payments (`scheme === "exact"`, network includes `"5042002"`,
`transferMethod === "eip3009"`). The nonce is a SHA-256 hash of:
`resource|sessionId|scope|role|payer|asset|payTo|amount|chainId`.

This means a retry with the same session/role/payer produces the same `bytes32`
nonce. If the first authorization was already settled on-chain, the second
attempt is rejected by the facilitator as `Eip3009NonceAlreadyUsed` — no
duplicate on-chain transfer.

**Environment variable:**

| Variable | Default | Description |
|----------|---------|-------------|
| `X402_DETERMINISTIC_NONCE` | `true` (unset) | Set to `false` to fall back to random nonce (manual experiments only) |

**Scope of deterministic nonce:**
- ✅ Arc native exact EIP-3009 (rail `arc-native-eoa`, network 5042002)
- ❌ Circle Gateway offchain/nanopayment mode
- ❌ Permit2
- ❌ Solana
- ❌ Non-EIP3009 payment modes

### 409 payment_in_flight

When the backend returns HTTP 409 with `error: "payment_in_flight"`, the bot
treats this as a non-fatal skip. It does not retry payment in the same cycle.
The caller receives `{ ok: false, skipped: true, error: 'payment_in_flight' }`.

## Safety Warnings

- Do not run with real trading keys or real funds.
- `MARKET_EXECUTION_MODE` must remain `DRY_RUN` for no-trade executor.
- `X402_AUTOPAY=true` enables live x402 payments.
- Each external bot must use unique `ARCLAYER_AGENT_ID`, `RUNTIME_ID`, and wallet key.
