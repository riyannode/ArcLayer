import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { fetchBtc15mMarket, fetchOrderbook, payloadHash } from '@/lib/polymarket/btc15m';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const market = await fetchBtc15mMarket();
  if (!market.ok) {
    return humanJson(req, market, { status: 404 });
  }
  const activeMarket = market as any;
  if (!activeMarket.tokenIds.up) {
    return humanJson(req, {
      ok: false,
      source: 'polymarket-clob',
      asset: 'BTC',
      timeframe: '15m',
      error: 'no_active_btc_15m_token',
      fetchedAt: new Date().toISOString(),
      payloadHash: market.payloadHash,
    }, { status: 404 });
  }

  const upBook = await fetchOrderbook(activeMarket.tokenIds.up);
  const downBook = activeMarket.tokenIds.down ? await fetchOrderbook(activeMarket.tokenIds.down) : { bids: [], asks: [], mid: null };
  const payload = {
    ok: true,
    source: 'polymarket-clob',
    asset: 'BTC',
    timeframe: '15m',
    marketSlug: activeMarket.marketSlug,
    conditionId: activeMarket.conditionId,
    tokenIds: activeMarket.tokenIds,
    bids: upBook.bids,
    asks: upBook.asks,
    mid: upBook.mid,
    up: upBook,
    down: downBook,
    fetchedAt: new Date().toISOString(),
  };

  return humanJson(req, { ...payload, payloadHash: payloadHash(payload) });
}
