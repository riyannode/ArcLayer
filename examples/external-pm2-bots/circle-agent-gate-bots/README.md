# Circle x402 Commerce Bots — Role-Based Event Graph

Independent PM2 bots that form a **role-based event graph** on ArcLayer.
Each bot runs as a standalone process, reads upstream events by role, and pays via Circle x402 commerce gate.

**Not a process pipeline.** No bot spawns another. Each bot can be started, stopped, or restarted independently.
All communication happens through the ArcLayer REST API.

## Architecture

```
             ┌──────────────┐
             │    Oracle    │
             │  market data │
             └──────┬───────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
 ┌──────────────┐        ┌──────────────┐
 │   Analyzer   │        │  Evaluator   │
 │ reads oracle │        │ reads oracle │
 │ technical    │        │ risk         │
 │ analysis     │        │ assessment   │
 └──────┬───────┘        └──────┬───────┘
        │                       │
        └───────────┬───────────┘
                    ▼
             ┌──────────────┐
             │   Executor   │
             │ reads latest │
             │ from analyzer│
             │ or evaluator │
             └──────────────┘
```

Each box = independent PM2 process. All connect to ArcLayer API, not to each other.

## How It Works

### Event Graph Routing

Each role has a built-in upstream mapping. No manual configuration needed:

| Role | Reads From | Event Type | Description |
|:-----|:-----------|:-----------|:------------|
| **Oracle** | (none) | `market_snapshot` | Generates market data. No upstream dependency. |
| **Analyzer** | Any `oracle` | `resolver_output` | Technical analysis of oracle data. |
| **Evaluator** | Any `oracle` | `evaluation` | Risk assessment of oracle data. |
| **Executor** | Any `analyzer` (fallback: `evaluator`) | `execution_intent` | Executes based on analysis or evaluation. |

The routing is defined in `run-commerce-bot.js`:

```javascript
const EVENT_GRAPH_UPSTREAM = {
  oracle:    null,               // no upstream — data source
  analyzer:  { role: "oracle" }, // reads from ANY oracle
  evaluator: { role: "oracle" }, // reads from ANY oracle
  executor:  { role: "analyzer" }, // reads from ANY analyzer (fallback: evaluator)
};
```

### What Happens Each Cycle (every 5 min)

1. **Oracle** generates market data via LLM → posts `market_snapshot` event → posts receipt → posts heartbeat
2. **Analyzer** reads latest `market_snapshot` from any oracle → runs technical analysis via LLM → posts `resolver_output` → pays oracle via x402
3. **Evaluator** reads latest `market_snapshot` from any oracle → runs risk assessment via LLM → posts `evaluation` → pays oracle via x402
4. **Executor** reads latest `resolver_output` from any analyzer (or `evaluation` from evaluator as fallback) → produces execution order → posts `execution_intent` → pays upstream via x402

### Blocking Behavior

- If no oracle events exist → analyzer and evaluator **block** (throw error, retry next cycle)
- If no analyzer/evaluator events exist → executor **blocks** (throw error, retry next cycle)
- Each bot retries every 5 minutes until upstream data becomes available

### Payment

Each bot (except oracle) pays its upstream via Circle x402 commerce gate:

| Buyer | Pays To | Scope |
|:------|:--------|:------|
| Analyzer | Oracle | `market_data` |
| Evaluator | Oracle | `market_data` |
| Executor | Analyzer or Evaluator | `analysis` or `evaluation` |

Payment is best-effort — if payment fails, the bot still completes its run and posts output.

## Quick Start

### 1. Prerequisites

- Node.js 18+
- PM2 (`npm install -g pm2`)
- ArcLayer API key (get from [arclayers.xyz](https://arclayers.xyz))
- Circle wallet with USDC on Arc Testnet (for x402 payments)

### 2. Install

```bash
cd examples/external-pm2-bots/circle-agent-gate-bots
npm install
```

### 3. Configure

```bash
# Create .env file
cat > .env << 'EOF'
# ArcLayer API
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_API_KEY=<your-api-key>

# Oracle
ARCLAYER_AGENT_ID_ORACLE=<your-oracle-agent-id>
ARCLAYER_API_KEY_ORACLE=<your-oracle-api-key>
BOT_PRIVATE_KEY_ORACLE=<wallet-private-key>

# Analyzer
ARCLAYER_AGENT_ID_ANALYZER=<your-analyzer-agent-id>
ARCLAYER_API_KEY_ANALYZER=<your-analyzer-api-key>
BOT_PRIVATE_KEY_ANALYZER=<wallet-private-key>

# Evaluator
ARCLAYER_AGENT_ID_EVALUATOR=<your-evaluator-agent-id>
ARCLAYER_API_KEY_EVALUATOR=<your-evaluator-api-key>
BOT_PRIVATE_KEY_EVALUATOR=<wallet-private-key>

# Executor
ARCLAYER_AGENT_ID_EXECUTOR=<your-executor-agent-id>
ARCLAYER_API_KEY_EXECUTOR=<your-executor-api-key>
BOT_PRIVATE_KEY_EXECUTOR=<wallet-private-key>

# LLM (shared or per-role)
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=<your-llm-api-key>
LLM_BASE_URL=https://api.openai.com/v1

# x402 Payment
X402_GATEWAY_CHAIN=arcTestnet
X402_SKIP_PAYMENT=false
EOF
```

### 4. Run

```bash
# Start all 4 bots (with stagger: 0s, 30s, 60s, 90s)
pm2 start run-loop.sh --name cg-oracle -- oracle
LOOP_INITIAL_DELAY=30 pm2 start run-loop.sh --name cg-analyzer -- analyzer
LOOP_INITIAL_DELAY=60 pm2 start run-loop.sh --name cg-evaluator -- evaluator
LOOP_INITIAL_DELAY=90 pm2 start run-loop.sh --name cg-executor -- executor

# Save for auto-restart on reboot
pm2 save
```

### 5. Monitor

```bash
pm2 status
pm2 logs cg-oracle --lines 20
pm2 logs cg-analyzer --lines 20
```

## Running a Single Role

You can run any role independently. For example, to run only the analyzer:

```bash
# Start only oracle + analyzer
pm2 start run-loop.sh --name cg-oracle -- oracle
pm2 start run-loop.sh --name cg-analyzer -- analyzer
```

The analyzer will block until oracle publishes data, then automatically start processing.

## External Bot Onboarding

Any external developer can join the event graph by running a bot with the correct role.
The bot automatically reads from the right upstream — no manual configuration needed.

### Example: Join as Analyzer

```bash
# 1. Register your agent on ArcLayer
# 2. Get API key with agent_bridge:write scope
# 3. Set env vars
export AGENT_ROLE=analyzer
export ARCLAYER_AGENT_ID=my-custom-analyzer
export ARCLAYER_API_KEY=ak_xxx
export X402_PAYER_PRIVATE_KEY=0x...
export LLM_PROVIDER=openai
export LLM_MODEL=gpt-4o-mini
export LLM_API_KEY=sk-xxx

# 4. Run
node run-commerce-bot.js
```

The bot will:
- Auto-detect its role as `analyzer`
- Read the latest `market_snapshot` events from ANY oracle
- Process data via LLM
- Post `resolver_output` event
- Pay the oracle via x402 (if payment enabled)

### Example: Join as Executor

```bash
export AGENT_ROLE=executor
export ARCLAYER_AGENT_ID=my-custom-executor
export ARCLAYER_API_KEY=ak_xxx
export X402_PAYER_PRIVATE_KEY=0x...

node run-commerce-bot.js
```

The executor will:
- Try to read `resolver_output` from any analyzer
- If no analyzer data → fallback to `evaluation` from any evaluator
- If neither exists → block and retry next cycle

## Bot Config Files

Each `bot.config.<role>.json` contains public metadata only:

```json
{
  "role": "analyzer",
  "market": "btc-15m",
  "category": "prediction-market-bots",
  "agentId": "apollo-analyzer",
  "runtimeId": "circle-commerce-analyzer-01",
  "llmModel": "deepseek/deepseek-v4-flash"
}
```

**Secrets (API keys, private keys) are in `.env` only.** Never commit `.env` files.

## Environment Variables

| Variable | Required | Description |
|:---------|:---------|:------------|
| `ARCLAYER_BASE_URL` | No | ArcLayer API base URL (default: `https://arclayers.xyz`) |
| `ARCLAYER_API_KEY` | Yes | Default API key for all roles |
| `ARCLAYER_API_KEY_<ROLE>` | No | Per-role API key override |
| `ARCLAYER_AGENT_ID_<ROLE>` | No | Per-role agent ID override |
| `BOT_PRIVATE_KEY_<ROLE>` | Yes | Wallet private key per role |
| `LLM_PROVIDER` | No | LLM provider (`openai`, `mock`) |
| `LLM_MODEL` | No | LLM model name |
| `LLM_API_KEY` | Yes | LLM API key |
| `LLM_BASE_URL` | No | LLM API base URL |
| `X402_SKIP_PAYMENT` | No | Set `true` to skip x402 payments |
| `X402_GATEWAY_CHAIN` | No | Chain for x402 settlement (default: `arcTestnet`) |
| `LOOP_INTERVAL` | No | Seconds between runs (default: `300`) |
| `LOOP_INITIAL_DELAY` | No | Seconds before first run (for stagger) |

## Stagger Configuration

To prevent all bots from spawning child processes at the same time:

```bash
pm2 start run-loop.sh --name cg-oracle -- oracle                    # 0s delay
LOOP_INITIAL_DELAY=30 pm2 start run-loop.sh --name cg-analyzer -- analyzer   # 30s delay
LOOP_INITIAL_DELAY=60 pm2 start run-loop.sh --name cg-evaluator -- evaluator # 60s delay
LOOP_INITIAL_DELAY=90 pm2 start run-loop.sh --name cg-executor -- executor   # 90s delay
```

## File Structure

```
circle-agent-gate-bots/
├── run-commerce-bot.js      # Main bot logic (all roles)
├── run-loop.sh              # PM2 wrapper with loop + stagger
├── run-oracle.sh            # Oracle env setup
├── run-analyzer.sh          # Analyzer env setup
├── run-evaluator.sh         # Evaluator env setup
├── run-executor.sh          # Executor env setup
├── bot.config.*.json        # Per-role public config
├── heartbeat.js             # Standalone heartbeat (optional)
├── package.json
└── shared/
    ├── arclayer-api.js      # ArcLayer API client
    ├── read-events.js       # Read upstream events by role
    ├── llm-processor.js     # LLM calls per role
    ├── llm-receipt.js       # Build LLM receipts
    ├── hash.js              # Payload hashing
    ├── pay-upstream.js      # x402 payment to upstream
    ├── commerce-route-map.js # Role → payment scope mapping
    ├── seller-commerce-client.js # Circle commerce gate client
    └── circle-gate-client.js # Circle Gateway client
```

## Troubleshooting

| Issue | Cause | Fix |
|:------|:------|:----|
| `BLOCKED: no oracle events` | Oracle hasn't run yet | Start oracle first, or wait for next cycle |
| `commerce payment skipped` | Missing wallet or API key | Check `.env` has `BOT_PRIVATE_KEY_<ROLE>` |
| `upstream read failed` | API key invalid or expired | Regenerate API key on ArcLayer |
| All data is identical | LLM is mock mode | Set `LLM_PROVIDER=openai` and `LLM_API_KEY` |
| Bot crashes on start | Missing `node_modules` | Run `npm install` |
