import { NextResponse } from 'next/server';

/**
 * GET /api/a2a/history?asset=BTC&interval=1h&fidelity=72
 *
 * Fetches Polymarket CLOB price history for the active 5m UP/DOWN YES token.
 * Returns array of { t, p } points for charting.
 *
 * Polymarket 5m markets are short-lived, so for longer chart context we fall
 * back to the parent recurring conditionId where available, else best-effort.
 */

function getAlignedTimestamp(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % 300);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const asset = (searchParams.get('asset') || 'BTC').toUpperCase();
  const interval = searchParams.get('interval') || '1h';
  const fidelity = searchParams.get('fidelity') || '72';

  const aligned = getAlignedTimestamp();
  // Walk back several windows so chart always has data — newest 5m market may have no history yet.
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
      return NextResponse.json({
        ok: false,
        error: `No ${asset} market history available`,
        history: [],
      });
    }

    // CLOB price history takes `market` = conditionId. Try conditionId first, then token.
    const url = `https://clob.polymarket.com/prices-history?market=${conditionId || tokenId}&interval=${interval}&fidelity=${fidelity}`;
    const histRes = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (!histRes.ok) {
      return NextResponse.json({
        ok: false,
        error: `history fetch failed: ${histRes.status}`,
        history: [],
      });
    }

    const data = await histRes.json();
    const history = (data.history || []).map((pt: any) => ({
      t: Number(pt.t),
      p: parseFloat(pt.p),
    }));

    return NextResponse.json({
      ok: true,
      asset,
      slug: marketSlug,
      conditionId,
      tokenId,
      interval,
      history,
      timestamp: Date.now(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'history_fetch_failed', history: [] },
      { status: 500 }
    );
  }
}
