# Market Agent Bridge — Prediction Market Bots

> **Standalone example.** This directory is NOT part of the root `pnpm-workspace.yaml`.
> Install and run from this folder independently.

Four independent PM2 bots that autonomously run a BTC 15-minute prediction market pipeline on Arc Testnet.

## Architecture

```
Oracle (LLM) ──market_snapshot──▶ Analyzer (LLM) ──resolver_output──▶ Evaluator (LLM) ──evaluation──▶ Executor (zero-guard)
     │                                  │                                  │                              │
     ├─ fetch Polymarket BTC 15m        ├─ BPS signal + LLM analysis       ├─ risk gate + LLM decision    ├─ poll evaluator output
     ├─ orderbook + candles             ├─ direction + confidence           ├─ approve/reject               ├─ post execution_intent
     └─ LLM summary + post event        └─ post analysis event             └─ post evaluation event        └─ x402 autopay (if approved)
```

**Each bot is a separate PM2 process. No bot spawns children. All run independently.**

## Bot Roles

| Bot | Role | LLM | Description |
|:----|:-----|:----|:------------|
| **Oracle** | Data fetcher | ✅ Yes | Fetches Polymarket BTC 15m market, orderbook, candles. Uses LLM to summarize raw data for downstream agents. |
| **Analyzer** | Market analyst | ✅ Yes | Reads oracle output, computes BPS signals, uses LLM to produce direction (UP/DOWN/NEUTRAL) + confidence. |
| **Evaluator** | Decision maker | ✅ Yes | Reads analyzer output, runs deterministic risk gates, uses LLM to make final APPROVE/REJECT decision. |
| **Executor** | Zero-guard poller | ❌ No | Polls for evaluator output. Posts execution intent + receipt. No LLM — pure relay. |

## 1. Install Dependencies

```bash
cd examples/external-pm2-bots/market-agent-bridge
npm install
```

## 2. Configure Env

Each bot has a shared `.env.common` + per-role `.env.<role>`:

```bash
cp .env.common.example   .env.common
cp .env.oracle.example   .env.oracle
cp .env.analyzer.example .env.analyzer
cp .env.evaluator.example .env.evaluator
cp .env.executor.example  .env.executor
```

Fill in for each role:
- `ARCLAYER_AGENT_ID` — minted ERC-8004 token ID
- `ARCLAYER_API_KEY` — A2A API key (scopes: `agent_bridge:write`, `agent_bridge:receipt`)
- `LLM_BASE_URL` + `LLM_MODEL` + `LLM_API_KEY` — LLM provider config (oracle, analyzer, evaluator only)
- `X402_PAYER_PRIVATE_KEY` — ERC-8004 controller wallet (needs ~20 USDC on Arc testnet)

**Never commit filled `.env` files.** The `.gitignore` excludes them all.

### LLM Configuration

Oracle, Analyzer, and Evaluator each have independent LLM configs in their `.env.<role>`:

```bash
# .env.oracle
LLM_BASE_URL=https://api.blockchain.info/ai/api/v1
LLM_MODEL=google/gemini-3-flash
LLM_API_KEY=<your-key>
USE_LLM=true

# .env.analyzer
LLM_BASE_URL=https://api.blockchain.info/ai/api/v1
LLM_MODEL=anthropic/claude-haiku-4.5
LLM_API_KEY=<your-key>
USE_LLM=true

# .env.evaluator
LLM_BASE_URL=https://api.blockchain.info/ai/api/v1
LLM_MODEL=x-ai/grok-4.3
LLM_API_KEY=<your-key>
USE_LLM=true
```

Executor has `USE_LLM=false` — it does not call any LLM.

## 3. Run with PM2

```bash
# Start all 4 bots + heartbeat (independent mode — default)
pm2 start ecosystem.config.cjs

# Monitor
pm2 status
pm2 logs oracle-bot --lines 20
pm2 logs analyzer-bot --lines 20
pm2 logs evaluator-bot --lines 20
pm2 logs executor-bot --lines 20
```

## 4. How It Works

### Cycle Flow (every 15 min by default)

1. **Oracle** fetches Polymarket BTC 15m data (market, orderbook, candles), calls LLM to summarize, posts `market_snapshot` event
2. **Analyzer** reads oracle's latest session, computes BPS signal, calls LLM for analysis, posts `resolver_output` event
3. **Evaluator** reads analyzer output, runs deterministic risk gates + LLM evaluation, posts `evaluation` event
4. **Executor** polls for evaluator output, posts `execution_intent` + receipt + live event. If approved + `X402_AUTOPAY=true`, pays x402 bridge access.

### Independence Model

Each bot is a standalone PM2 process:
- **No child spawning** — each bot runs its own `runForever()` loop
- **No inter-process communication** — bots communicate via ArcLayer API events
- **Role locks** — filesystem-based locks prevent duplicate processing per session (oracle, analyzer, evaluator)
- **Dedup guards** — API-level dedup prevents duplicate events per role+session
- **Heartbeat** — each bot posts a heartbeat live event after every cycle

### Safety Guards

| Env Var | Default | Description |
|:--------|:--------|:------------|
| `BOT_INTERVAL_MS` | `900000` (15 min) | Cycle interval for all bots |
| `MAX_ACTIVE_JOBS` | `3` | Max jobs per cycle (evaluator/executor) |
| `X402_AUTOPAY` | `true` | Enable autonomous x402 payment |
| `X402_AUTOPAY_REQUIRED` | `false` | Fail cycle if autopay fails |
| `USE_LLM` | `true` | Enable/disable LLM calls per role |
| `MARKET_EXECUTION_MODE` | `DRY_RUN` | DRY_RUN or LIVE |

## 5. PM2 Ecosystem Config

The `ecosystem.config.cjs` starts all bots in **independent mode** (default):

```bash
pm2 start ecosystem.config.cjs
```

Each bot:
- Runs as a single `fork` mode process
- Loads `.env.common` + `.env.<role>` via `env-loader.js`
- Has `RUN_FOREVER=true` set by PM2 env
- Restarts automatically on crash (PM2 default)

## 6. Common Errors

| Error | Cause | Fix |
|:------|:------|:----|
| `missing_env:ARCLAYER_AGENT_ID` | `.env.<role>` not filled | Copy `.env.<role>.example` → `.env.<role>` and fill values |
| `missing_llm_env` | LLM config incomplete | Set `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` in `.env.<role>` |
| `lock_exists` | Another process already processing this session | Normal — role lock prevents duplicates. Wait for next cycle. |
| `no_oracle_session` | Oracle hasn't posted yet | Wait for oracle to complete its cycle first |
| `participant_mismatch` | API key agentId doesn't match | Ensure `ARCLAYER_AGENT_ID` matches the API key's agentId |
| `x402_autopay_failed` | Wallet out of USDC | Top up wallet via Arc Testnet faucet |

## 7. Security Notes

- **Never commit `.env` files.** The `.gitignore` excludes all `.env.*` files.
- Each bot has its own API key scoped to only the actions it needs.
- API key is sent via `Authorization: Bearer` header.
- Wallet private keys never leave the bot process.
- `DRY_RUN` mode is default — no real trade execution.

## 8. Production Checklist

- [ ] Register 4 agents in ERC-8004 registry (oracle, analyzer, evaluator, executor)
- [ ] Generate role-scoped A2A API keys
- [ ] Fund wallets with USDC + ARC gas tokens
- [ ] Copy `.env.*.example` → `.env.*` and fill all values
- [ ] Set `USE_LLM=true` for oracle, analyzer, evaluator
- [ ] Set `USE_LLM=false` for executor
- [ ] Test one full cycle manually (`pm2 start ecosystem.config.cjs`)
- [ ] Monitor logs for errors
- [ ] Set `MARKET_EXECUTION_MODE=DRY_RUN` for testing
