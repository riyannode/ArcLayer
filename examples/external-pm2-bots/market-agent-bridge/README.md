# ArcLayer External PM2 Market Agent Bridge

External PM2 market agent bridge example: external PM2 bots make market decisions while ArcLayer acts as the protocol bridge for identity, x402 access, bridge events, receipts, payload hashes, and proof history on Arc.

This is **not** a generic external LLM demo and not a real trading executor.

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

1. `oracle-bot.js` fetches ArcLayer raw BTC 15m Polymarket market/orderbook/candles feed and posts `role=oracle`.
2. `analyzer-bot.js` reads latest bridge session, uses local deterministic logic or an optional local LLM provider, and posts `role=analyzer`.
3. `evaluator-bot.js` evaluates analyzer output outside ArcLayer and posts `role=evaluator`.
4. `executor-bot.js` posts a DRY_RUN execution intent only. It never places real trades.
5. ArcLayer stores the bridge event, `payloadHash`, `runtimeId`, `job_id`/category metadata, receipt/history, and x402 unlock status.
6. `POST /api/x402/bridge-access` returns `402` without payment and returns the unlocked bridge session/receipt after valid payment.
7. `/live-a2a-agent` shows the full flow.

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
# Fill ARCLAYER_API_KEY + role-specific envs locally. Never commit .env.*.
npm install dotenv
```

Bot startup loads `.env.common` first, then `.env.<role>` overrides it.
PM2 ecosystem config controls mode keys (`EVENT_CHAIN_ENABLED`, `RUN_FOREVER`).

For external agent setup (custom agent ID):

```bash
cp .env.external-agent.example .env.<custom-role>
```

Optional local LLM:

```bash
LLM_BASE_URL=
LLM_MODEL=
LLM_API_KEY=local-only-key
```

`LLM_API_KEY` is sent only to the configured local/OpenAI-compatible LLM provider. It is never sent to ArcLayer or Supabase and must never be printed.

## Run one-shot smoke

```bash
node oracle-bot.js
node analyzer-bot.js
node evaluator-bot.js
node executor-bot.js
```

## Independent mode (4 processes)

```bash
pm2 delete oracle-bot analyzer-bot evaluator-bot executor-bot 2>/dev/null || true
pm2 start ecosystem.independent.config.cjs
pm2 save
pm2 status
```

Expected:
- PM2 has exactly 4 processes.
- oracle-bot runs forever.
- analyzer-bot runs forever and waits for oracle market_snapshot.
- evaluator-bot runs forever and waits for analyzer resolver_output.
- executor-bot runs forever and waits for evaluator evaluation.
- oracle does not spawn children because `EVENT_CHAIN_ENABLED=false`.

## Chain mode (1 process, oracle spawns children)

```bash
pm2 delete oracle-bot analyzer-bot evaluator-bot executor-bot 2>/dev/null || true
pm2 start ecosystem.chain.config.cjs
pm2 save
```

Expected:
- PM2 has only oracle-bot.
- oracle spawns analyzer/evaluator/executor once per cycle via `spawnSync`.
- Do not run independent mode and chain mode at the same time.

## One-shot smoke (no PM2)

```bash
EVENT_CHAIN_ENABLED=false RUN_FOREVER=false node oracle-bot.js
```

## Safety

- `.env` is ignored by repo policy; `.env.example` contains placeholders only.
- `DRY_RUN=true` is required. Setting `DRY_RUN=false` throws.
- Keep `MARKET_EXECUTION_MODE=DRY_RUN` for this bridge integration.
- x402 autopay requires: `X402_AUTOPAY=true`, `PROTOCOL_TX_MODE=ARC_TESTNET`, and an unpaid session.
- No LLM API key, private key, exchange key, or wallet private key is sent to ArcLayer or Supabase.
- ArcLayer stores only non-sensitive bridge metadata: `agent_id`, `runtime_id`, `session_id`, `job_id`, `category`, role, event payload hashes, receipts, and timestamps.

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

## Required env for x402 executor lifecycle
- `MARKET_EXECUTION_MODE=DRY_RUN`
- `PROTOCOL_TX_MODE=ARC_TESTNET`
- `X402_AUTOPAY=true`
- `X402_AUTOPAY_REQUIRED=false`
- `X402_SCOPE=external_trace`
- `ARC_RPC_URL`
- `ARCLAYER_BASE_URL`
- `ARCLAYER_API_KEY=<required>`
- `A2A_LIVE_EVENTS_TOKEN=<required>`
- `X402_PAYER_PRIVATE_KEY=<required for real x402 only>`

## Warnings

- Do not run **chain mode** and **independent mode** at the same time.
- Do not run old shared `.env` mode unless `LEGACY_SHARED_ENV=true`.
- `MARKET_EXECUTION_MODE` must remain `DRY_RUN` for no-trade executor.
- `X402_AUTOPAY=true` enables live x402 payments.
- Each external bot must use unique `ARCLAYER_AGENT_ID`, `RUNTIME_ID`, and wallet key.
- Do not put `EVENT_CHAIN_ENABLED` in `.env.oracle`; use ecosystem config for mode control.
