import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@/lib/x402';

/**
 * GET /api/x402/history?asset=BTC&interval=1h&fidelity=72 — x402-gated price history.
 *
 * External agents pay 0.002 USDC per call for Polymarket CLOB price history.
 * Internal UI uses /api/a2a/history.
 */

export const runtime = 'nodejs';

function getAlignedTimestamp(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % 300);
}

async function handler(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const asset = (searchParams.get('asset') || 'BTC').toUpperCase();
  const interval = searchParams.get('interval') || '1h';
  const fidelity = searchParams.get('fidelity') || '72';

  if (!['BTC', 'ETH'].includes(asset)) {
    return NextResponse.json({ ok: false, error: 'asset must be BTC or ETH', history: [] }, { status: 400 });
  }

  const aligned = getAlignedTimestamp();
  const slugs = [
    `${asset.toLowerCase()}-updown-5m-${aligned}`,
    `${asset.toLowerCase()}-updown-5m-${aligned - 300}`,
    `${asset.toLowerCase()}-updown-5m-${aligned - 600}`,
    `${asset.toLowerCase()}-updown-5m-${aligned - 900}`,
  ];

  try {
    let conditionId: string | null = null;
    let tokenId: string | null = null;
    let marketSlug = '';

    for (const slug of slugs) {
      const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
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

    if (!conditionId && !tokenId) {
      return NextResponse.json({ ok: false, error: `No ${asset} market history available`, history: [] });
    }

    const url = `https://clob.polymarket.com/prices-history?market=${conditionId || tokenId}&interval=${interval}&fidelity=${fidelity}`;
    const histRes = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (!histRes.ok) {
      return NextResponse.json({ ok: false, error: `history fetch failed: ${histRes.status}`, history: [] });
    }

    const data = await histRes.json();
    const history = Array.isArray(data?.history) ? data.history : [];

    return NextResponse.json({
      ok: true,
      paid: true,
      asset,
      marketSlug,
      conditionId,
      tokenId,
      interval,
      fidelity: Number(fidelity),
      timestamp: Date.now(),
      source: 'clob.polymarket.com',
      history,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'history_fetch_failed', history: [] }, { status: 500 });
  }
}

// 0.002 USDC = 2000 atomic (6 decimals)
export const GET = withX402(handler, {
  amount: '2000',
  resource: '/api/x402/history',
  description: 'Polymarket CLOB price history for 5m UP/DOWN markets',
});
