import { NextResponse } from 'next/server';

/**
 * GET /api/a2a/orderbook?asset=BTC
 * Fetches real Polymarket CLOB orderbook for the current 5m UP/DOWN market.
 * Returns bids/asks for the YES token.
 */

function getAlignedTimestamp(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % 300);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const asset = (searchParams.get('asset') || 'BTC').toUpperCase();

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
          tokenId = ids[0]; // YES token
          conditionId = m.conditionId || null;
          marketSlug = m.slug;
          break;
        }
      }
    }

    if (!tokenId) {
      return NextResponse.json({
        ok: false,
        error: `No active ${asset} 5m market found`,
        book: { bids: [], asks: [] },
      });
    }

    // Fetch orderbook from CLOB
    const bookRes = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });

    if (!bookRes.ok) {
      return NextResponse.json({
        ok: false,
        error: `CLOB book fetch failed: ${bookRes.status}`,
        book: { bids: [], asks: [] },
      });
    }

    const book = await bookRes.json();

    // Also fetch midpoint
    let mid: number | null = null;
    try {
      const midRes = await fetch(`https://clob.polymarket.com/midpoint?token_id=${tokenId}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      if (midRes.ok) {
        const midData = await midRes.json();
        mid = parseFloat(midData.mid) || null;
      }
    } catch { /* non-critical */ }

    return NextResponse.json({
      ok: true,
      asset,
      slug: marketSlug,
      conditionId,
      tokenId,
      mid,
      bids: (book.bids || []).slice(0, 10),
      asks: (book.asks || []).slice(0, 10),
      timestamp: Date.now(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'orderbook_fetch_failed', book: { bids: [], asks: [] } },
      { status: 500 }
    );
  }
}
