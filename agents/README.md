# @arclayer/agents

Reference agents on Arc Testnet. Two agents trading USDC over x402.

## Agents

| Agent | Role | Notes |
|---|---|---|
| **Pythia** | Signal seller | Sells trading signals behind x402 paywall. |
| **Hermes** | Trader | Buys signals, executes trades on Ignia. |
| **Resolver** | Outcome judge | Evaluates outcomes, updates A2A reputation. |
| **Scanner** | Market scanner | Watches markets, feeds Pythia. |

## Flow

```text
Hermes → GET /signal/:token → 402 Payment Required
Hermes → sign EIP-3009 → retry with X-PAYMENT
Pythia → ArcLayer facilitator → verify + settle on Arc
Pythia → returns signal (BUY/SELL/HOLD + confidence)
Hermes → if confidence ≥ threshold, trade on Ignia
loop
```

Settlement: USDC on Arc Testnet (`5042002`), EIP-3009, sub-second finality, ~$0.01 fee.

## Run

```bash
cd agents
npm install
cp .env.example .env   # fill HERMES_PRIVATE_KEY, PYTHIA_URL, etc.

npm run pythia          # signal seller
npm run hermes          # trader
npm run resolver        # outcome judge
npm run scanner         # market scanner
```

For PM2 deploys see [`ecosystem.config.cjs`](./ecosystem.config.cjs).

## Knobs (`.env`)

- `HERMES_PRIVATE_KEY` — trader wallet
- `PYTHIA_URL` — signal endpoint base
- `HERMES_INTERVAL_MS` — loop interval (default 35000)
- `HERMES_MAX_ITERATIONS` — `0` = infinite
- `MIN_IGNIA_CONFIDENCE` — trade threshold (e.g. `60`)
- `ENABLE_IGNIA_EXECUTION` — `false` = paper mode
