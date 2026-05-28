# Circle x402 Agent Commerce Bots

Autonomous prediction-market bots that pay each other through Circle Gateway x402 batched payments.

Each bot runs independently — own wallet, API key, `.env`, and identity. No pipeline controller. No PM2 dependency chain. They read upstream data from the REST API (Supabase-backed), process it, pay the seller via Circle Gateway, and publish output.

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

```
1. LLM generates market snapshot
2. POST /api/agent-bridge/events (type: market_snapshot)
3. POST receipt_reference (rail: x402_circle_commerce)
```

### Analyzer / Evaluator / Executor (buyers)

```
1. GET /api/agent-bridge/events?role=<upstream>&filterType=<output_type>
   → reads only the seller's output (market_snapshot / resolver_output / evaluation)
   → filters out purchase intents (bridge_event) and receipts (receipt_reference)
2. LLM processes upstream data
3. POST /api/agent-bridge/events (purchase intent bridge_event)
4. GatewayClient.pay() → POST /api/x402/agent-commerce-gate
   → EIP-3009 authorization signed against GatewayWallet contract
   → Circle Gateway batched USDC settlement
   → Returns batch ID (UUID)
5. POST /api/agent-bridge/events (output: resolver_output / evaluation / execution_intent)
6. POST receipt_reference with llmReceipt
```

## Event Type Filtering

Each buyer reads only the seller's output event type, not their purchase intents:

| Buyer | Reads from | Event type |
|-------|-----------|------------|
| Analyzer | Oracle | `market_snapshot` |
| Evaluator | Analyzer | `resolver_output` |
| Executor | Evaluator | `evaluation` |

## Commerce Route Map

Scope and access type enforced per role pair:

| Buyer | Seller | Scope | Access Type |
|-------|--------|-------|-------------|
| Analyzer | Oracle | `market_data` | `oracle_data` |
| Evaluator | Analyzer | `analysis` | `analysis` |
| Executor | Evaluator | `evaluation` | `evaluation` |

Wrong scope = backend returns `403 access_type_not_allowed`.

## Circle Gateway Payment

Buyers pay sellers through Circle's gasless batched payment system:

1. GatewayClient reads payment requirements from backend 402 response
2. Signs EIP-3009 `TransferWithAuthorization` against `GatewayWallet` contract
3. Backend verifies + settles via `facilitator.settle()`
4. Circle batches the payment — settlement confirmation is async
5. Payment is non-fatal: bot skips payment on `X402_SKIP_PAYMENT=true` or on failure

## Quick Start

```bash
npm install

# 1. Copy and configure environment
cp .env.example .env
# Edit .env with your ArcLayer API key, wallet, etc.

# 2. Copy a bot config template (or create your own)
cp bot.config.example.json bot.config.oracle.json
# Edit bot.config.oracle.json with your agent IDs

# 3. Register commerce profiles (one-time)
node scripts/register-commerce-profile.js

# 4. Deposit USDC to Circle Gateway (one-time per wallet)
node scripts/gateway-deposit.js

# 5. Run bots independently
AGENT_ROLE=oracle node run-commerce-bot.js
AGENT_ROLE=analyzer UPSTREAM_ROLE=oracle UPSTREAM_AGENT_ID=<oracle-id> node run-commerce-bot.js
AGENT_ROLE=evaluator UPSTREAM_ROLE=analyzer UPSTREAM_AGENT_ID=<analyzer-id> node run-commerce-bot.js
AGENT_ROLE=executor UPSTREAM_ROLE=evaluator UPSTREAM_AGENT_ID=<evaluator-id> node run-commerce-bot.js
```

## Loop Mode (PM2 Production)

For long-lived production deployment:

```bash
# Run with loop wrapper (respects .env, validates required vars)
bash run-loop.sh oracle
bash run-loop.sh analyzer
bash run-loop.sh evaluator
bash run-loop.sh executor

# Or use PM2 ecosystem
pm2 start pm2/ecosystem.config.js
pm2 logs commerce-oracle
```

See [presets/arc-demo/](presets/arc-demo/) for ArcLayer testnet bot configs.

## Environment Variables

See [.env.example](.env.example) for full list with defaults.

| Variable | Required | Description |
|----------|----------|-------------|
| `ARCLAYER_AGENT_ID` | Yes | Bot agent ID |
| `ARCLAYER_API_KEY` | Yes | Bot API key |
| `X402_PAYER_PRIVATE_KEY` | Yes | Wallet private key for Circle Gateway |
| `UPSTREAM_AGENT_ID` | Buyer only | Seller agent ID to read from and pay |
| `UPSTREAM_ROLE` | Buyer only | Seller role (`oracle` / `analyzer` / `evaluator`) |
| `LLM_API_KEY` | No | LLM API key (falls back to mock) |
| `LOOP_INTERVAL` | No | Seconds between runs (default: 300) |

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

## Design Principles

- **Autonomous** — each bot runs independently, reads from REST API, no shared memory
- **Non-fatal payments** — payment failure doesn't block output publication
- **Type-safe upstream reads** — filterType prevents reading wrong event types
- **LLM resilient** — mock fallback when quota exhausted
- **Scope enforced** — backend rejects wrong access types
- **Already-paid safe** — duplicate payments treated as success, not error
- **BigInt safe** — Circle SDK responses serialized without BigInt errors
