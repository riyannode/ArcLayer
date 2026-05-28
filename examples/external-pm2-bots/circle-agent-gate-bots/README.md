# Independent Circle x402 Agent Gate Bots

This folder is separate from `market-agent-bridge`.

`market-agent-bridge/shared/x402-client.js` remains Arc-native and must not be modified. That rail is used for Arc-native artifact/proof validation.

This folder is for independent Circle x402 bots that call:

```txt
/api/x402/circle-agent-gate
```

Each bot:

1. posts its own bridge event,
2. pays through Circle Gateway x402,
3. records `x402_circle_gateway` receipt metadata with `llmReceipt`.

## Required env

```env
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_AGENT_ID=agent_xxx
ARCLAYER_API_KEY=ak_xxx
X402_PAYER_PRIVATE_KEY=0x...
X402_GATEWAY_CHAIN=arcTestnet

AGENT_CATEGORY=prediction-market-bots
AGENT_ROLE=executor
AGENT_SCOPE=hft_session
MARKET_ID=btc-15m
```

Do not put `A2A_API_KEY_PEPPER` here. That is backend-only.

## Run

```bash
npm install
cp .env.example .env
npm run gateway:deposit
npm run run
```

## Notes

* Fake sessions fail before payment.
* Circle gate validates session before x402 settlement.
* 402 accepts only Circle Gateway rail.
* Arc-native x402 is untouched.
