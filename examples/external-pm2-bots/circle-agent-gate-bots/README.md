# Independent Circle x402 Agent Gate Bots

Standalone Circle x402 bots. **Not a pipeline.** Each bot runs independently — reads its own `.env`, posts its own bridge event, pays its own Circle Gateway fee, records its own receipt. Zero inter-bot dependency.

```
circle-agent-gate-bots/
├── run-bot.js              ← single entrypoint, single process
├── .env.example            ← template (SAFE to commit)
├── bot.config.example.json ← template
├── bot.config.<role>.json  ← per-bot config (SAFE to commit, no secrets)
├── shared/
│   ├── hash.js             ← sha256 + sessionId helpers
│   ├── llm-receipt.js      ← buildLlmReceipt
│   ├── arclayer-api.js     ← postBridgeEvent + postReceiptReference
│   └── circle-gate-client.js ← payCircleAgentGate via GatewayClient
└── scripts/
    └── gateway-deposit.js   ← deposit USDC into Circle Gateway
```

## Per-bot flow (self-contained)

```
1. postBridgeEvent()    → create session + get payloadHash
2. payCircleAgentGate() → pay via Circle Gateway x402 at /api/x402/circle-agent-gate
3. postReceiptReference() → record x402_circle_gateway receipt + llmReceipt
```

Each bot is independent:
- **Oracle** (tokenId=25883) `circle-oracle-01`
- **Analyzer** (tokenId=25884) `circle-analyzer-01`
- **Evaluator** (tokenId=25885) `circle-evaluator-01`
- **Executor** (tokenId=25886) `circle-executor-01`

## Arc-Native vs Circle x402

| | Arc-Native (`market-agent-bridge`) | Circle x402 (`circle-agent-gate-bots`) |
|---|---|---|
| Pipeline | oracle→analyzer→evaluator→executor | NONE |
| Dependency | upstream down → downstream blocked | Bot down → other bots unaffected |
| Spawn children | `runner.js` spawns per-window subprocess | NONE |
| Payment rail | Arc Native EIP-3009 | Circle Gateway x402 |
| Receipt type | `x402_arc_native` | `x402_circle_gateway` |
| Session | Shared per-pipeline | Per-bot, isolated |

## Quick Start

```bash
cd examples/external-pm2-bots/circle-agent-gate-bots
npm install
cp .env.example .env
# fill .env with ARCLAYER_AGENT_ID, ARCLAYER_API_KEY, X402_PAYER_PRIVATE_KEY
```

## Run (one bot at a time)

```bash
# Oracle
cp .env.oracle .env && npm run run

# Analyzer
cp .env.analyzer .env && npm run run

# Evaluator
cp .env.evaluator .env && npm run run

# Executor
cp .env.executor .env && npm run run
```

## PM2 (production)

```bash
pm2 start run-bot.js --name circle-oracle    --env .env.oracle
pm2 start run-bot.js --name circle-analyzer  --env .env.analyzer
pm2 start run-bot.js --name circle-evaluator --env .env.evaluator
pm2 start run-bot.js --name circle-executor  --env .env.executor
```

Four isolated PM2 processes. Kill one, the other three keep running.

## Gateway Deposit (first time only)

```bash
npm run gateway:deposit
```

Deposits USDC from the burner wallet into Circle Gateway so x402 payments can execute.

## Required env

```env
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_AGENT_ID=<tokenId>
ARCLAYER_API_KEY=ak_xxx
X402_PAYER_PRIVATE_KEY=0x...
X402_GATEWAY_CHAIN=arcTestnet

AGENT_CATEGORY=prediction-market-bots
AGENT_ROLE=oracle|analyzer|evaluator|executor
AGENT_SCOPE=hft_session
MARKET_ID=btc-15m
```

## Notes

* NEVER commit `.env` / `.env.<role>` — they contain private keys
* `A2A_API_KEY_PEPPER` is backend-only, do not set in bot env
* `market-agent-bridge/shared/x402-client.js` is **NEVER modified** by this folder
* Arc-native x402 remains the canonical artifact/proof validation rail
* Fake sessions fail before payment — Circle gate validates session existence
* No `child_process`, no `spawn`, no pipeline — pure `node run-bot.js`
