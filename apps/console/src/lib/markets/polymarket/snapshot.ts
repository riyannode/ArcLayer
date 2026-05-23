import { createHash } from 'node:crypto';
import { fetchCandles1mForRange } from './candles';
import { fetchOrderbook } from './clob';
import { fetchActiveUpDownMarket } from './gamma';
import type { Asset, Candle1m, LiveSnapshot } from './types';

function pickTargetAndLive(candles: Candle1m[], windowStart: number) {
  if (!candles.length) {
    return {
      targetPrice: null,
      livePrice: null,
      distanceFromTarget: null,
      directionNow: 'UNKNOWN' as const,
    };
  }

  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const startCandle =
    [...sorted].reverse().find((c) => c.timestamp <= windowStart) ??
    sorted.find((c) => c.timestamp >= windowStart) ??
    sorted[0];

  const latest = sorted[sorted.length - 1];
  const targetPrice = startCandle.open;
  const livePrice = latest.close;
  const distanceFromTarget = livePrice - targetPrice;

  return {
    targetPrice,
    livePrice,
    distanceFromTarget,
    directionNow: livePrice > targetPrice ? ('UP' as const) : livePrice < targetPrice ? ('DOWN' as const) : ('FLAT' as const),
  };
}

export async function getLiveSnapshot(asset: Asset): Promise<LiveSnapshot | null> {
  const market = await fetchActiveUpDownMarket(asset);
  if (!market) return null;

  const chartWindowStart = market.windowStart - 3 * 60 * 60;
  const chartWindowEnd = Math.min(Math.floor(Date.now() / 1000), market.windowEnd);
  const [upBook, downBook, candleResult] = await Promise.all([
    fetchOrderbook(market.outcomes.up.tokenId),
    fetchOrderbook(market.outcomes.down.tokenId),
    fetchCandles1mForRange(asset, chartWindowStart, chartWindowEnd),
  ]);

  const candles = candleResult.candles;
  const capturedAt = new Date().toISOString();
  const { targetPrice, livePrice, distanceFromTarget, directionNow } = pickTargetAndLive(candles, market.windowStart);

  const evidence = { market, upBook, downBook, candleTail: candles.slice(-10), capturedAt, candleSource: candleResult.candleSource, candleError: candleResult.candleError, chartWindowStart, chartWindowEnd };
  const rawEvidenceHash = `0x${createHash('sha256').update(JSON.stringify(evidence)).digest('hex')}`;

  return {
    asset,
    marketSlug: market.marketSlug,
    question: market.question,
    conditionId: market.conditionId,
    windowStart: market.windowStart,
    windowEnd: market.windowEnd,
    targetPrice,
    livePrice,
    distanceFromTarget,
    directionNow,
    outcomes: market.outcomes,
    orderbook: { up: upBook, down: downBook },
    candles1m: candles,
    candleSource: candleResult.candleSource,
    candleError: candleResult.candleError,
    chartWindowStart,
    chartWindowEnd,
    targetWindowStart: market.windowStart,
    targetWindowEnd: market.windowEnd,
    capturedAt,
    rawEvidenceHash,
  };
}
