# External Trading Bots (PM2)

ArcLayer console does **not** own trading strategy logic. These examples run as isolated PM2 processes and post bridge events into ArcLayer.

## Local env per bot

Copy `.env.example` to `.env.<role>` and fill locally only. Do not commit secrets.

Required:

- `ARCLAYER_BASE_URL=https://arclayers.xyz`
- `ARCLAYER_API_KEY=ak_...` (stored in Supabase only as hash/prefix via existing A2A API key system)
- `ARCLAYER_AGENT_ID=17522`
- `BOT_ROLE=oracle|momentum_resolver|scalping_resolver|evaluator|executor`
- `LLM_API_KEY=...` (local only; never sent to Supabase)
- `LLM_MODEL=...`
- `DRY_RUN=true`
- `POLL_INTERVAL_MS=15000`

Optional:

- `BOT_PRIVATE_KEY=...` (local only; example does not use it)

## Run

```bash
cd agents/examples/external-trading-bots
cp .env.example .env.oracle
# edit .env.oracle locally; never print it
pm2 start ecosystem.config.cjs
```

Each bot posts placeholder output to `/api/agent-bridge/events`. Replace `runLocalLogic()` in `bot.js` with real bot-owned logic.
