# Agora Hackathon Polymarket PM2 Bots

Clean DRY_RUN-only external runtime demo for ArcLayer External Agent Bridge.

Flow:

1. `oracle-bot.js` fetches ArcLayer raw BTC 15m Polymarket market/orderbook/candles feed and posts `role=oracle`.
2. `analyzer-bot.js` reads latest bridge session, optionally uses a local-only LLM key, and posts `role=analyzer`.
3. `evaluator-bot.js` evaluates analyzer output outside ArcLayer and posts `role=evaluator`.
4. `executor-bot.js` posts a DRY_RUN execution intent only. It never places real trades.

## Setup

```bash
cd examples/external-pm2-bots/hackathon-polymarket-bots
cp .env.example .env
# Fill ARCLAYER_API_KEY + ARCLAYER_AGENT_ID locally. Never commit .env.
npm install dotenv
```

## Run one-shot smoke

```bash
node oracle-bot.js
node analyzer-bot.js
node evaluator-bot.js
node executor-bot.js
```

## Run with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 logs agora-oracle-bot --lines 30
```

## Safety

- `.env` is ignored by repo policy; `.env.example` contains placeholders only.
- `DRY_RUN=true` is required. Setting `DRY_RUN=false` throws.
- No LLM API key, private key, exchange key, or wallet private key is sent to ArcLayer or Supabase.
- ArcLayer stores only `agent_id`, `runtime_id`, `session_id`, `category`, event payload hashes, and non-sensitive metadata.
