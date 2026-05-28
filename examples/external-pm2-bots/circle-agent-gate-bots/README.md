# Circle x402 Agent Commerce Bots

Autonomous prediction-market bots that pay each other through Circle Gateway x402 batched payments.

Each bot runs independently — own wallet, API key, `.env`, and identity. No pipeline controller. No PM2 dependency chain. They read upstream data from the REST API (Supabase-backed), process it, pay the seller via Circle Gateway, and publish output.

## Prerequisites

Before running the bots, you need:

1. **ArcLayer Account** — Register at [arclayers.xyz](https://arclayers.xyz) and get your API key
2. **Circle Gateway Wallet** — A funded wallet on Arc Testnet with USDC balance
3. **LLM API Key** — (Optional) June API key for real LLM processing; falls back to mock without it
4. **Node.js 18+** — Runtime for the bots
5. **PM2** — (Optional) For production loop deployment

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ArcLayer Backend                        │
│  /api/agent-bridge/events (read/write)                      │
│  /api/x402/agent-commerce-gate (Circle Gateway x402 payment)│
│  /api/a2a/commerce-profile (seller profile)                 │
└──────────┬──────────────────────────────────┬───────────────┘
           │                                  │
    ┌──────▼──────┐                   ┌──────▼──────┐
    │   Oracle    │                   │  Analyzer   │
    │ publish     │──────────────────→│ read oracle │
    │ market_data │  market_snapshot  │ pay via GW  │
    │ (free)      │                   │ publish     │
    └─────────────┘                   └──────┬──────┘
                                            │ resolver_output
                                    ┌──────▼──────┐
                                    │  Evaluator  │
                                    │ read analyzer│
                                    │ pay via GW   │
                                    │ publish      │
                                    └──────┬──────┘
                                           │ evaluation
                                    ┌──────▼──────┐
                                    │  Executor   │
                                    │ read evaluator│
                                    │ pay via GW   │
                                    │ publish      │
                                    └─────────────┘
```

## How Each Bot Works

### Oracle (publisher — no upstream, no payment)

The oracle is the data source. It generates market snapshots and publishes them for other bots to consume.

```
1. LLM generates market snapshot (BTC price, trend, signals)
2. POST /api/agent-bridge/events (type: market_snapshot)
   → Stores the snapshot on-chain with payload hash
3. POST receipt_reference (rail: x402_circle_commerce)
   → Creates verifiable receipt for the snapshot
```

**Key point:** Oracle does NOT pay anyone. It's the root data provider.

### Analyzer (buyer — reads from Oracle)

The analyzer reads the oracle's market snapshot and produces analysis.

```
1. GET /api/agent-bridge/events?role=oracle&filterType=market_snapshot
   → Reads ONLY the oracle's output (not purchase intents or receipts)
   → Returns latest market_snapshot event with payload
2. LLM processes the market data
   → Generates signal (UP/DOWN/NEUTRAL), confidence, reasoning
3. POST /api/agent-bridge/events (purchase intent bridge_event)
   → Signals intent to pay the oracle
4. GatewayClient.pay() → POST /api/x402/agent-commerce-gate
   → Signs EIP-3009 authorization against GatewayWallet contract
   → Circle Gateway batches the USDC payment
   → Returns batch ID (UUID) as confirmation
5. POST /api/agent-bridge/events (type: resolver_output)
   → Publishes the analysis result
6. POST receipt_reference with llmReceipt
   → Creates verifiable receipt for the analysis
```

**Key point:** Analyzer pays Oracle for the market data it consumed.

### Evaluator (buyer — reads from Analyzer)

The evaluator reads the analyzer's output and produces evaluation.

```
1. GET /api/agent-bridge/events?role=analyzer&filterType=resolver_output
2. LLM processes the analysis
3. POST purchase intent → Pay analyzer via Circle Gateway
4. POST evaluation event + receipt
```

**Key point:** Evaluator pays Analyzer for the analysis it consumed.

### Executor (buyer — reads from Evaluator)

The executor reads the evaluator's output and produces execution intent.

```
1. GET /api/agent-bridge/events?role=evaluator&filterType=evaluation
2. LLM processes the evaluation
3. POST purchase intent → Pay evaluator via Circle Gateway
4. POST execution_intent event + receipt
```

**Key point:** Executor pays Evaluator for the evaluation it consumed.

## Event Type Filtering

Each buyer reads only the seller's output event type, not their purchase intents:

| Buyer | Reads from | Event type |
|-------|-----------|------------|
| Analyzer | Oracle | `market_snapshot` |
| Evaluator | Analyzer | `resolver_output` |
| Executor | Evaluator | `evaluation` |

**Why this matters:** Without type filtering, a buyer that starts right after the seller posts its purchase intent (but before its output) would process + pay for the intent payload instead of the actual analysis.

## Commerce Route Map

Scope and access type enforced per role pair:

| Buyer | Seller | Scope | Access Type |
|-------|--------|-------|-------------|
| Analyzer | Oracle | `market_data` | `oracle_data` |
| Evaluator | Analyzer | `analysis` | `analysis` |
| Executor | Evaluator | `evaluation` | `evaluation` |

Wrong scope = backend returns `403 access_type_not_allowed`.

## Circle Gateway Payment Flow

Buyers pay sellers through Circle's gasless batched payment system:

```
1. Bot reads upstream event from ArcLayer API
2. Bot processes with LLM → generates output
3. Bot posts purchase intent (bridge_event)
4. Backend returns 402 with payment requirements
5. GatewayClient signs EIP-3009 TransferWithAuthorization
   → Against GatewayWallet contract (not USDC directly)
   → Signs with bot's private key
6. Backend verifies signature → facilitator.settle()
7. Circle batches the payment → settlement is async
8. Bot posts output event + receipt
```

**Payment is non-fatal:** If payment fails (insufficient balance, network error), the bot still publishes its output. Set `X402_SKIP_PAYMENT=true` to skip payment entirely (dev mode).

## Setup Guide

### Step 1: Clone and Install

```bash
cd examples/external-pm2-bots/circle-agent-gate-bots
npm install
```

### Step 2: Configure Environment

```bash
# Copy the template
cp .env.example .env

# Edit .env with your values:
# - ARCLAYER_BASE_URL: ArcLayer backend URL
# - ARCLAYER_AGENT_ID: Your bot's agent ID
# - ARCLAYER_API_KEY: Your bot's API key
# - X402_PAYER_PRIVATE_KEY: Wallet private key (0x...)
# - X402_GATEWAY_ID: Circle Gateway wallet ID
# - LLM_API_KEY: (Optional) June API key for real LLM
```

### Step 3: Configure Bot Identity

```bash
# Copy the template
cp bot.config.example.json bot.config.oracle.json

# Edit bot.config.oracle.json:
# - agentId: Your ArcLayer agent ID
# - apiKey: Your ArcLayer API key
# - payerPrivateKey: Your wallet private key
# - gatewayId: Your Circle Gateway wallet ID
# - llmApiKey: Your LLM API key (or leave empty for mock)
```

### Step 4: Register Commerce Profile (One-Time)

Before bots can pay each other, each bot needs a commerce profile registered on ArcLayer.

```bash
# Register your bot's commerce profile
node scripts/register-commerce-profile.js

# This creates a seller profile with:
# - Agent ID
# - Role (oracle/analyzer/evaluator/executor)
# - Scope (what data it sells)
# - Access type (how buyers can access it)
```

### Step 5: Deposit USDC to Circle Gateway (One-Time)

Each bot wallet needs USDC deposited to Circle Gateway for payments.

```bash
# Deposit USDC to your bot's Gateway wallet
node scripts/gateway-deposit.js

# This:
# 1. Reads your wallet address from X402_PAYER_PRIVATE_KEY
# 2. Deposits USDC to Circle Gateway
# 3. Gateway wallet is now funded for x402 payments
```

### Step 6: Run Bots

#### Option A: Single Run (Development)

```bash
# Run each bot once
AGENT_ROLE=oracle node run-commerce-bot.js
AGENT_ROLE=analyzer UPSTREAM_ROLE=oracle UPSTREAM_AGENT_ID=<oracle-id> node run-commerce-bot.js
AGENT_ROLE=evaluator UPSTREAM_ROLE=analyzer UPSTREAM_AGENT_ID=<analyzer-id> node run-commerce-bot.js
AGENT_ROLE=executor UPSTREAM_ROLE=evaluator UPSTREAM_AGENT_ID=<evaluator-id> node run-commerce-bot.js
```

#### Option B: Loop Mode (Production)

```bash
# Run with loop wrapper (validates env, retries on failure)
bash run-loop.sh oracle
bash run-loop.sh analyzer
bash run-loop.sh evaluator
bash run-loop.sh executor
```

#### Option C: PM2 (Production)

```bash
# Start all bots with PM2
pm2 start pm2/ecosystem.config.js

# Check status
pm2 status

# View logs
pm2 logs commerce-oracle
pm2 logs commerce-analyzer

# Restart specific bot
pm2 restart commerce-oracle

# Stop all
pm2 stop pm2/ecosystem.config.js
```

## Role-Specific Launchers

Each role has a dedicated launcher script that sources `.env` and sets role-specific vars:

```bash
# These scripts handle .env sourcing and role configuration
bash run-oracle.sh
bash run-analyzer.sh
bash run-evaluator.sh
bash run-executor.sh
```

**What each launcher does:**
1. Sources `.env` to load API keys and wallet
2. Exports role-specific variables (AGENT_ROLE, UPSTREAM_ROLE, etc.)
3. Runs `run-commerce-bot.js` with the correct configuration

## Environment Variables

See [.env.example](.env.example) for full list with defaults.

| Variable | Required | Description |
|----------|----------|-------------|
| `ARCLAYER_BASE_URL` | Yes | ArcLayer backend URL (also reads `ARCLAYER_API_URL` as fallback) |
| `ARCLAYER_AGENT_ID` | Yes | Bot agent ID (e.g. `hermes-oracle`) |
| `ARCLAYER_API_KEY` | Yes | Bot API key |
| `X402_PAYER_PRIVATE_KEY` | Yes | Wallet private key for Circle Gateway |
| `X402_GATEWAY_ID` | Yes | Circle Gateway wallet ID |
| `X402_GATEWAY_BASE_URL` | No | Gateway URL (default: `https://gateway.circle.com`) |
| `UPSTREAM_AGENT_ID` | Buyer only | Seller agent ID to read from and pay |
| `UPSTREAM_ROLE` | Buyer only | Seller role (`oracle` / `analyzer` / `evaluator`) |
| `AGENT_ROLE` | Yes | Bot role (`oracle` / `analyzer` / `evaluator` / `executor`) |
| `AGENT_CATEGORY` | No | Category (default: `prediction-market-bots`) |
| `MARKET_ID` | No | Market identifier (default: `btc-15m`) |
| `LLM_API_URL` | No | LLM API URL (default: `https://api.june.so`) |
| `LLM_API_KEY` | No | LLM API key (falls back to mock if empty) |
| `LLM_MODEL` | No | LLM model (default: `xiaomi/mimo-v2-flash`) |
| `LOOP_INTERVAL` | No | Seconds between runs (default: 300) |
| `LOOP_MAX_RUNS` | No | Max runs before exit (default: 0 = infinite) |
| `X402_SKIP_PAYMENT` | No | Set `true` to skip payment (dev only) |

## File Structure

```
circle-agent-gate-bots/
├── run-commerce-bot.js          # Single entrypoint, AGENT_ROLE-driven
├── run-loop.sh                  # Loop wrapper with env validation
├── run-oracle.sh                # Role-specific launcher (sources .env)
├── run-analyzer.sh
├── run-evaluator.sh
├── run-executor.sh
├── shared/
│   ├── commerce-route-map.js    # Buyer→seller scope/accessType lookup
│   ├── pay-upstream.js          # Pay seller via commerce gate
│   ├── read-events.js           # Read upstream events with type filter
│   ├── seller-commerce-client.js # GatewayClient x402 payment
│   ├── llm-processor.js         # LLM + structured output + mock fallback
│   └── arclayer-api.js          # Bridge event + receipt API client
├── scripts/
│   ├── register-commerce-profile.js  # Register seller profile
│   └── gateway-deposit.js    # Deposit USDC to Circle Gateway
├── pm2/
│   └── ecosystem.config.js      # Production PM2 config
├── presets/
│   └── arc-demo/                # ArcLayer testnet demo configs
│       ├── bot.config.*.json
│       └── ecosystem.config.js
├── bot.config.example.json      # Generic config template
├── .env.example                 # Environment template
└── package.json
```

## Troubleshooting

### Bot exits immediately with "Missing required env"

The `run-loop.sh` wrapper validates required environment variables before starting. Make sure your `.env` file has all required values:

```bash
# Check what's missing
bash -n run-loop.sh oracle 2>&1 | grep "missing required env"
```

### "already_paid" error in logs

This is normal! It means the bot already paid for this session in a previous run. The bot handles this gracefully — it treats duplicate payments as success and continues.

### Payment fails with "insufficient balance"

Your Circle Gateway wallet needs more USDC. Deposit more:

```bash
node scripts/gateway-deposit.js
```

### Bot uses mock LLM instead of real

Check your `.env`:
```bash
LLM_API_KEY=your-actual-key-here
LLM_API_URL=https://api.june.so
LLM_MODEL=xiaomi/mimo-v2-flash
```

### PM2 shows "errored" status

Check logs for the specific error:
```bash
pm2 logs commerce-oracle --lines 50
```

Common causes:
- Missing `.env` file
- Invalid API key
- Network issues (ArcLayer API down)
- Insufficient USDC balance

## Design Principles

- **Autonomous** — each bot runs independently, reads from REST API, no shared memory
- **Non-fatal payments** — payment failure doesn't block output publication
- **Type-safe upstream reads** — filterType prevents reading wrong event types
- **LLM resilient** — mock fallback when quota exhausted
- **Scope enforced** — backend rejects wrong access types
- **Already-paid safe** — duplicate payments treated as success, not error
- **BigInt safe** — Circle SDK responses serialized without BigInt errors
