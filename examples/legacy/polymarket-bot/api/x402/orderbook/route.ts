import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';

/**
 * GET /api/x402/orderbook?asset=BTC — x402-gated Polymarket live orderbook.
 *
 * External agents pay 0.002 USDC per call for current 5m UP/DOWN CLOB depth.
 * Internal UI uses /api/a2a/orderbook.
 */

export const runtime = 'nodejs';

function getAlignedTimestamp(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % 300);
}

async function handler(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const asset = (searchParams.get('asset') || 'BTC').toUpperCase();

  if (!['BTC', 'ETH'].includes(asset)) {
    return NextResponse.json({ ok: false, error: 'asset must be BTC or ETH', book: { bids: [], asks: [] } }, { status: 400 });
  }

  const aligned = getAlignedTimestamp();
  const slugs = [
    `${asset.toLowerCase()}-updown-5m-${aligned}`,
    `${asset.toLowerCase()}-updown-5m-${aligned - 300}`,
  ];

  try {
    let tokenId: string | null = null;
    let conditionId: string | null = null;
    let marketSlug = '';

    for (const slug of slugs) {
      const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const markets = await res.json();
      if (Array.isArray(markets) && markets.length > 0) {
        const m = markets[0];
        const ids = JSON.parse(m.clobTokenIds || '[]');
        if (ids.length >= 1) {
          tokenId = ids[0];
          conditionId = m.conditionId || null;
          marketSlug = m.slug;
          break;
        }
      }
    }

    if (!tokenId) {
      return NextResponse.json({ ok: false, error: `No active ${asset} 5m market found`, book: { bids: [], asks: [] } });
    }

    const bookRes = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });

    if (!bookRes.ok) {
      return NextResponse.json({ ok: false, error: `CLOB book fetch failed: ${bookRes.status}`, book: { bids: [], asks: [] } });
    }

    const book = await bookRes.json();

    let mid: number | null = null;
    try {
      const midRes = await fetch(`https://clob.polymarket.com/midpoint?token_id=${tokenId}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      if (midRes.ok) {
        const midData = await midRes.json();
        mid = midData.mid ? Number(midData.mid) : null;
      }
    } catch {
      mid = null;
    }

    return NextResponse.json({
      ok: true,
      paid: true,
      asset,
      marketSlug,
      conditionId,
      tokenId,
      midpoint: mid,
      timestamp: Date.now(),
      source: 'clob.polymarket.com',
      book,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'orderbook_fetch_failed', book: { bids: [], asks: [] } }, { status: 500 });
  }
}

// 0.003 USDC = 3000 atomic (6 decimals)
export const GET = withX402(handler, {
  amount: '3000',
  resource: '/api/x402/orderbook',
  description: 'Polymarket live orderbook for current 5m UP/DOWN market',
});
