require('dotenv/config');
const { currentSessionId, getJson, postEvent } = require('./shared/arclayer-client');

async function main() {
  const [market, orderbook, candles] = await Promise.all([
    getJson('/api/data/polymarket/btc-15m'),
    getJson('/api/data/polymarket/btc-15m/orderbook'),
    getJson('/api/data/polymarket/btc-15m/candles'),
  ]);

  const payload = {
    market,
    orderbook: {
      source: orderbook.source,
      marketSlug: orderbook.marketSlug,
      mid: orderbook.mid,
      bestBid: orderbook.bids?.[0] || null,
      bestAsk: orderbook.asks?.[0] || null,
      depth: { bids: orderbook.bids?.length || 0, asks: orderbook.asks?.length || 0 },
      payloadHash: orderbook.payloadHash,
    },
    candles: {
      source: candles.source,
      livePrice: candles.livePrice,
      count: candles.candles?.length || 0,
      latest: candles.candles?.at?.(-1) || null,
      payloadHash: candles.payloadHash,
    },
  };

  await postEvent({
    sessionId: currentSessionId(),
    role: 'oracle',
    type: 'market_snapshot',
    runtimeId: process.env.RUNTIME_ID || 'pm2-oracle-bot',
    payload,
  });
}

main().catch((err) => {
  console.error(`[oracle] ${err.message}`);
  process.exitCode = 1;
});
