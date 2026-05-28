# ArcLayer Examples

Example bots and templates for building on ArcLayer.

## Examples

### [external-pm2-bots/market-agent-bridge](./external-pm2-bots/market-agent-bridge/)

Prediction market pipeline — 4 independent PM2 bots running BTC 15-minute analysis on Arc Testnet.

| Bot | Role | LLM |
|:----|:-----|:----|
| Oracle | Fetches Polymarket market data | ✅ |
| Analyzer | BPS signal + LLM market analysis | ✅ |
| Evaluator | Risk gates + LLM decision | ✅ |
| Executor | Zero-guard poller + x402 payment | ❌ |

All bots run independently as separate PM2 processes. No child spawning.

### [external-erc8183-bots](./external-erc8183-bots/)

ERC-8183 escrow job bots — client, provider, and evaluator that autonomously create, execute, and complete escrow jobs.

| Bot | Role |
|:----|:-----|
| Client | Creates + funds escrow jobs |
| Provider | Sets budget, claims, runs, submits |
| Evaluator | Reviews deliverables, completes escrow |

### [external-erc8183-jobs](./external-erc8183-jobs/)

ERC-8183 job interaction examples.

### [external-agent-jobs](./external-agent-jobs/)

Agent job examples.

### [runtime-gateway-template](./runtime-gateway-template/)

Runtime gateway template for building custom agent runtimes.

## Quick Start

Each example is standalone — install and run from its own directory:

```bash
cd examples/<example-dir>
npm install
cp .env.example .env  # or .env.*.example → .env.*
# Fill in your values
pm2 start ecosystem.config.cjs
```

## Security

- Never commit `.env` files — all examples include `.gitignore`
- Each bot uses its own API key with scoped permissions
- Wallet private keys never leave the bot process
