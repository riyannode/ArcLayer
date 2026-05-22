import { createHash } from 'node:crypto';
import { fetchBinanceCandles1m } from './candles';
import { fetchOrderbook } from './clob';
import { fetchActiveUpDownMarket } from './gamma';
import type { Asset, LiveSnapshot } from './types';

const targetFromQuestion = (question: string) => {
  const m = question.match(/\$?([0-9]{2,}(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : null;
};

export async function getLiveSnapshot(asset: Asset): Promise<LiveSnapshot | null> {
  const market = await fetchActiveUpDownMarket(asset);
  if (!market) return null;
  const [upBook, downBook, candles] = await Promise.all([
    fetchOrderbook(market.outcomes.up.tokenId), fetchOrderbook(market.outcomes.down.tokenId), fetchBinanceCandles1m(asset, 60),
  ]);
  const capturedAt = new Date().toISOString();
  const livePrice = candles.at(-1)?.close ?? null;
  const targetPrice = targetFromQuestion(market.question);
  const distanceFromTarget = livePrice != null && targetPrice != null ? livePrice - targetPrice : null;
  const directionNow = distanceFromTarget == null ? 'UNKNOWN' : distanceFromTarget > 0 ? 'UP' : distanceFromTarget < 0 ? 'DOWN' : 'FLAT';
  const evidence = { market, upBook, downBook, candleTail: candles.slice(-10), capturedAt };
  const rawEvidenceHash = `0x${createHash('sha256').update(JSON.stringify(evidence)).digest('hex')}`;
  return { asset, marketSlug: market.marketSlug, question: market.question, conditionId: market.conditionId, windowStart: market.windowStart, windowEnd: market.windowEnd, targetPrice, livePrice, distanceFromTarget, directionNow, outcomes: market.outcomes, orderbook: { up: upBook, down: downBook }, candles1m: candles, capturedAt, rawEvidenceHash };
}
