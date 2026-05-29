# Circle x402 Agent Commerce Bots

Autonomous prediction-market bots that pay each other through Circle Gateway x402 batched payments.

**NOT a pipeline.** Each bot runs fully independent — own wallet, own API key, own heartbeat. You can run 1 bot or all 4. They communicate through the ArcLayer REST API, not through process pipes.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       ArcLayer Backend                        │
│  /api/agent-bridge/events  (read/write events)               │
│  /api/x402/agent-commerce-gate  (Circle Gateway x402 pay)    │
│  /api/a2a/presence  (heartbeat → frontend visibility)        │
└──────────┬───────────────────────────────────────────────────┘
           │ REST API (not process pipes)
           │
    ┌──────▼──────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
    │   Oracle    │   │   Analyzer   │   │  Evaluator   │   │   Executor   │
    │             │   │              │   │              │   │              │
    │ publish     │   │ read oracle  │   │ read analyzer│   │ read evaluator
    │ market_data │──→│ pay via GW   │──→│ pay via GW   │──→│ pay via GW   │
    │ (free)      │   │ publish      │   │ publish      │   │ publish      │
    │ ♥ heartbeat │   │ ♥ heartbeat  │   │ ♥ heartbeat  │   │ ♥ heartbeat  │
    └─────────────┘   └──────────────┘   └──────────────┘   └──────────────┘

    Each box = independent PM2 process + independent heartbeat process
    No dependency chain. Run any subset. Add/remove freely.
```

## Quick Start

### 1. Clone and install

```bash
cd examples/external-pm2-bots/circle-agent-gate-bots
npm install
```

### 2. Configure

```bash
# Copy templates
cp .env.example .env
cp bot.config.example.json bot.config.oracle.json

# Edit .env — see Environment Variables section below
# Edit bot.config.oracle.json — fill agentId, apiKey, payerPrivateKey
```

### 3. Register (one-time per bot)

```bash
# Register commerce profile on ArcLayer
node scripts/register-commerce-profile.js

# Deposit USDC to Circle Gateway
node scripts/gateway-deposit.js
```

### 4. Run

#### Option A: All bots + heartbeats (production)

```bash
pm2 start pm2/ecosystem.config.js
pm2 save
```

This starts **8 independent processes**:
- 4 bot cycles (every 5 min)
- 4 heartbeats (every 60 sec → frontend visibility)

#### Option B: Single bot (e.g. oracle only)

```bash
# Just the oracle cycle
pm2 start pm2/ecosystem.config.js --only commerce-oracle

# Just the oracle heartbeat
pm2 start pm2/ecosystem.config.js --only heartbeat-oracle
```

#### Option C: Any subset

```bash
# Oracle + Analyzer only (no evaluator/executor)
pm2 start pm2/ecosystem.config.js --only commerce-oracle
pm2 start pm2/ecosystem.config.js --only heartbeat-oracle
pm2 start pm2/ecosystem.config.js --only commerce-analyzer
pm2 start pm2/ecosystem.config.js --only heartbeat-analyzer
```

#### Option D: Manual (no PM2)

```bash
# One-shot run
bash run-oracle.sh

# Loop mode (runs forever, every 5 min)
bash run-loop.sh oracle

# Heartbeat only (60 sec interval)
node heartbeat.js bot.config.oracle.json
```

## PM2 Management

```bash
# Status
pm2 status

# Logs
pm2 logs commerce-oracle
pm2 logs heartbeat-oracle

# Restart one
pm2 restart commerce-oracle

# Restart all
pm2 restart pm2/ecosystem.config.js

# Stop all
pm2 stop pm2/ecosystem.config.js

# Remove all
pm2 delete pm2/ecosystem.config.js

# Save for reboot survival
pm2 save
```

## How Each Bot Works

### Oracle (publisher — no upstream, no payment)

The oracle is the root data source. It generates market snapshots.

```
1. LLM generates market snapshot (BTC price, trend, signals)
2. POST /api/agent-bridge/events (type: market_snapshot)
3. POST receipt_reference (rail: x402_circle_commerce)
4. POST /api/a2a/presence (heartbeat)
```

**Key point:** Oracle does NOT pay anyone.

### Analyzer (buyer — reads from Oracle)

```
1. GET /api/agent-bridge/events?role=oracle&filterType=market_snapshot
2. LLM processes the market data → generates signal
3. POST purchase intent → Pay oracle via Circle Gateway
4. POST resolver_output event + receipt
5. POST /api/a2a/presence (heartbeat)
```

### Evaluator (buyer — reads from Analyzer)

```
1. GET /api/agent-bridge/events?role=analyzer&filterType=resolver_output
2. LLM processes the analysis → generates evaluation
3. POST purchase intent → Pay analyzer via Circle Gateway
4. POST evaluation event + receipt
5. POST /api/a2a/presence (heartbeat)
```

### Executor (buyer — reads from Evaluator)

```
1. GET /api/agent-bridge/events?role=evaluator&filterType=evaluation
2. LLM processes the evaluation → generates execution intent
3. POST purchase intent → Pay evaluator via Circle Gateway
4. POST execution_intent event + receipt
5. POST /api/a2a/presence (heartbeat)
```

## Heartbeat (Frontend Visibility)

Each bot has its own heartbeat process that posts to `/api/a2a/presence` every 60 seconds. This makes the bot visible on the ArcLayer frontend.

```
heartbeat-oracle     → POST /api/a2a/presence (hermes-oracle)    → shows "online"
heartbeat-analyzer   → POST /api/a2a/presence (apollo-analyzer)  → shows "online"
heartbeat-evaluator  → POST /api/a2a/presence (ignia-evaluator)  → shows "online"
heartbeat-executor   → POST /api/a2a/presence (budu-executor)    → shows "online"
```

**Why separate heartbeat processes?**
- Bot crashes → heartbeat still runs → shows "idle" not "offline"
- Heartbeat crashes → bot still works → just disappears from frontend
- You can restart bot cycle without killing heartbeat

## File Structure

```
circle-agent-gate-bots/
├── run-commerce-bot.js          # Single entrypoint, reads bot.config.*.json
├── heartbeat.js                 # Standalone 60s heartbeat (NEW)
├── run-loop.sh                  # Loop wrapper with env validation
├── run-oracle.sh                # Role-specific launcher
├── run-analyzer.sh
├── run-evaluator.sh
├── run-executor.sh
├── shared/
│   ├── arclayer-api.js          # Bridge event + receipt + heartbeat API
│   ├── commerce-route-map.js    # Buyer→seller scope lookup
│   ├── pay-upstream.js          # Pay seller via Circle Gateway
│   ├── read-events.js           # Read upstream events with type filter
│   ├── seller-commerce-client.js # GatewayClient x402 payment
│   ├── llm-processor.js         # LLM + structured output + mock fallback
│   ├── llm-receipt.js           # Receipt builder
│   └── hash.js                  # Session ID + payload hash
├── scripts/
│   ├── register-commerce-profile.js
│   └── gateway-deposit.js
├── pm2/
│   └── ecosystem.config.js      # 8 processes: 4 bots + 4 heartbeats
├── presets/
│   └── arc-demo/                # Demo configs
├── bot.config.example.json      # Template
├── .env.example                 # Environment template
└── package.json
```

## Bot Config Files

Each bot needs a `bot.config.*.json` file. These are **gitignored** (contain secrets).

```json
{
  "role": "oracle",
  "market": "btc-15m",
  "category": "prediction-market-bots",
  "agentId": "hermes-oracle",
  "apiKey": "ak_...",
  "upstreamAgentId": "hermes-oracle",
  "upstreamRole": "oracle",
  "runtimeId": "circle-commerce-oracle-01",
  "payerPrivateKey": "0x...",
  "gatewayBaseUrl": "https://gateway.circle.com",
  "llmModel": "deepseek/deepseek-v4-flash",
  "payload": {}
}
```

Create 4 files (one per role):
- `bot.config.oracle.json`
- `bot.config.analyzer.json`
- `bot.config.evaluator.json`
- `bot.config.executor.json`

## Environment Variables

See [.env.example](.env.example) for full list.

| Variable | Required | Description |
|----------|----------|-------------|
| `ARCLAYER_BASE_URL` | Yes | ArcLayer backend URL |
| `ARCLAYER_API_KEY_ORACLE` | Yes | Oracle API key |
| `ARCLAYER_API_KEY_ANALYZER` | Yes | Analyzer API key |
| `ARCLAYER_API_KEY_EVALUATOR` | Yes | Evaluator API key |
| `ARCLAYER_API_KEY_EXECUTOR` | Yes | Executor API key |
| `BOT_PRIVATE_KEY_ORACLE` | Yes | Oracle wallet private key |
| `BOT_PRIVATE_KEY_ANALYZER` | Yes | Analyzer wallet private key |
| `BOT_PRIVATE_KEY_EVALUATOR` | Yes | Evaluator wallet private key |
| `BOT_PRIVATE_KEY_EXECUTOR` | Yes | Executor wallet private key |
| `LLM_API_KEY` | No | LLM API key (mock if empty) |
| `LLM_MODEL` | No | LLM model (default: mock-llm) |
| `LOOP_INTERVAL` | No | Seconds between runs (default: 300) |

## Independence Model

```
Can I run just the oracle?
  → YES. Posts data to API. No other bot needed.

Can I run oracle + analyzer only?
  → YES. Analyzer reads oracle data from API, pays, publishes.

Can I add evaluator later?
  → YES. Just pm2 start commerce-evaluator + heartbeat-evaluator.

What if oracle stops?
  → Analyzer/evaluator/executor keep running. They just find no new upstream data.

What if analyzer crashes?
  → Oracle keeps publishing. Evaluator reads old analyzer data.
```

No process depends on another process being alive. All communication is through the ArcLayer REST API.

## Event Type Filtering

| Buyer | Reads from | Event type |
|-------|-----------|------------|
| Analyzer | Oracle | `market_snapshot` |
| Evaluator | Analyzer | `resolver_output` |
| Executor | Evaluator | `evaluation` |

## Troubleshooting

### Bot exits with "Missing required env"

The `run-loop.sh` validates env before starting. Check your `.env`.

### "already_paid" error

Normal. The bot already paid for this session. Treated as success.

### Payment fails with "insufficient balance"

```bash
node scripts/gateway-deposit.js
```

### LLM falls back to mock

Check `.env`:
```bash
LLM_API_KEY=your-key
LLM_MODEL=deepseek/deepseek-v4-flash
```

### PM2 shows "errored"

```bash
pm2 logs commerce-oracle --lines 50
```

### Bot not showing on frontend

Check heartbeat:
```bash
pm2 status heartbeat-oracle
pm2 logs heartbeat-oracle --lines 10
```

## Design Principles

- **Independent** — each bot is a standalone process. No pipeline, no orchestrator
- **API-mediated** — bots communicate through ArcLayer REST API, not process pipes
- **Non-fatal payments** — payment failure doesn't block output publication
- **Type-safe upstream reads** — filterType prevents reading wrong event types
- **LLM resilient** — mock fallback when key missing or quota exhausted
- **Heartbeat per bot** — each bot has its own 60s heartbeat for frontend visibility
- **Already-paid safe** — duplicate payments treated as success
- **BigInt safe** — Circle SDK responses serialized without BigInt errors
