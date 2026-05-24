# External PM2 Market Agent Bridge

Multi-agent prediction market bot running on VPS via PM2.

## Architecture

4 independent agents, each with dedicated LLM and wallet config:

| Bot | Role | Mode |
|:---|:---|:---|
| **Oracle** | Fetches raw Polymarket BTC 15m feed | `RUN_FOREVER=true` |
| **Analyzer** | LLM market analysis | `RUN_FOREVER=true` |
| **Evaluator** | Risk evaluation | `RUN_FOREVER=true` |
| **Executor** | DRY_RUN execution intent | `RUN_FOREVER=true` |

## Modes

### Independent (default)
4 separate PM2 processes, each runs forever. Oracle does NOT spawn children.

```bash
pm2 start ecosystem.independent.config.cjs
```

### Chain
1 PM2 process (oracle only). Oracle spawns children per cycle via spawnSync.

```bash
pm2 start ecosystem.chain.config.cjs
```

Do not run both modes at the same time.

## Env loading

Each bot loads `.env.common` first, then `.env.<role>` overrides it.
PM2 ecosystem config controls mode keys (`EVENT_CHAIN_ENABLED`, `RUN_FOREVER`).

```bash
cp .env.common.example .env.common
cp .env.oracle.example .env.oracle
cp .env.analyzer.example .env.analyzer
cp .env.evaluator.example .env.evaluator
cp .env.executor.example .env.executor
```

## Security

- `.env.*` gitignored; only `.env.*.example` tracked.
- No API keys, private keys, or wallet keys in repo.
- Each bot uses unique `ARCLAYER_AGENT_ID`, `RUNTIME_ID`, and x402 wallet.
