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

Without this filter, a buyer that starts right after the seller posts its purchase intent (but before its output) would process + pay for the intent payload instead of the actual analysis.

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
2. Signs EIP-3009 `TransferWithAuthorization` against `GatewayWallet` contract (not USDC directly)
3. Backend verifies + settles via `facilitator.settle()`
4. Circle batches the payment — settlement confirmation is async
5. Payment is non-fatal: bot skips payment on `X402_SKIP_PAYMENT=true` or on failure, still publishes output

## Bot Identities (Arc Testnet)

| Agent | Role | Wallet |
|-------|------|--------|
| `hermes-oracle` | Oracle | `0x51a6...514e` |
| `apollo-analyzer` | Analyzer | `0xd515...98b5` |
| `ignia-evaluator` | Evaluator | `0x9fC7...eE5` |
| `budu-executor` | Executor | `0xda1d...A1D` |

Each bot has:
- Own ERC-8004 agent identity
- Own API key (scopes: `agent_bridge:write`, `agent_bridge:receipt`)
- Own Circle Gateway wallet (deposited with USDC on Arc Testnet)
- Own `.env` config in `generated-env/`

## Quick Start

```bash
npm install

# 1. Register commerce profiles (one-time)
npm run commerce:profile

# 2. Deposit USDC to Circle Gateway (one-time per bot)
npm run gateway:deposit

# 3. Run bots independently — order doesn't matter,
#    each bot reads historical upstream data from the API
AGENT_ROLE=oracle npm run commerce:run
AGENT_ROLE=analyzer UPSTREAM_ROLE=oracle UPSTREAM_AGENT_ID=hermes-oracle npm run commerce:run
AGENT_ROLE=evaluator UPSTREAM_ROLE=analyzer UPSTREAM_AGENT_ID=apollo-analyzer npm run commerce:run
AGENT_ROLE=executor UPSTREAM_ROLE=evaluator UPSTREAM_AGENT_ID=ignia-evaluator npm run commerce:run
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ARCLAYER_BASE_URL` | Yes | ArcLayer backend URL |
| `ARCLAYER_AGENT_ID` | Yes | Bot agent ID (e.g. `hermes-oracle`) |
| `ARCLAYER_API_KEY` | Yes | Bot API key |
| `X402_PAYER_PRIVATE_KEY` | Yes | Wallet private key for Circle Gateway payments |
| `X402_GATEWAY_CHAIN` | Yes | Chain for Gateway (e.g. `arcTestnet`) |
| `AGENT_CATEGORY` | Yes | Category (e.g. `prediction-market-bots`) |
| `AGENT_ROLE` | Yes | Role: `oracle` / `analyzer` / `evaluator` / `executor` |
| `MARKET_ID` | Yes | Market identifier (e.g. `btc-15m`) |
| `UPSTREAM_AGENT_ID` | Buyer only | Seller agent ID to pay |
| `UPSTREAM_ROLE` | Buyer only | Seller role |
| `LLM_API_KEY` | No | June API key (falls back to mock) |
| `X402_SKIP_PAYMENT` | No | Set to `true` to skip payment (dev only) |

## Files

```
circle-agent-gate-bots/
├── run-commerce-bot.js       # Single entrypoint, AGENT_ROLE-driven
├── run-bot.js                # Legacy single-bot runner
├── shared/
│   ├── commerce-route-map.js # Buyer→seller scope/accessType lookup
│   ├── pay-upstream.js       # Pay seller via commerce gate
│   ├── read-events.js        # Read upstream events with type filter
│   ├── seller-commerce-client.js  # GatewayClient x402 payment
│   ├── llm-processor.js      # June API + structured output + mock fallback
│   ├── llm-receipt.js        # LLM receipt builder
│   ├── arclayer-api.js       # Bridge event + receipt API client
│   └── hash.js               # Session ID generator
├── scripts/
│   ├── register-commerce-profile.js  # Register seller profile
│   └── gateway-deposit.js    # Deposit USDC to Circle Gateway
├── generated-env/            # Per-bot .env files
├── bot.config.*.json         # Per-role config
└── .env.example              # Template
```

## Design Principles

- **Autonomous** — each bot runs independently, reads from REST API, no shared memory
- **Non-fatal payments** — payment failure doesn't block output publication
- **Type-safe upstream reads** — filterType prevents reading wrong event types
- **LLM resilient** — mock fallback when quota exhausted
- **Scope enforced** — backend rejects wrong access types
- **CodeQL clean** — no process.env values leaked in logs
