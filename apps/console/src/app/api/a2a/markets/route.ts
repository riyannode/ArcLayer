import { NextResponse } from 'next/server';

/**
 * GET /api/a2a/markets
 * Fetches live Polymarket BTC & ETH UP/DOWN 5-minute markets.
 * Returns current prices, volume, and market metadata.
 */

interface MarketData {
  slug: string;
  question: string;
  asset: 'BTC' | 'ETH';
  timeframe: '5m';
  upPrice: number;
  downPrice: number;
  volume: number | null;
  startTime: string;
  endTime: string;
  active: boolean;
}

function getAlignedTimestamp(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % 300);
}

function parseTimeFromQuestion(question: string): { start: string; end: string } {
  // "Bitcoin Up or Down - May 18, 7:00AM-7:05AM ET"
  const match = question.match(/(\d{1,2}:\d{2}[AP]M)-(\d{1,2}:\d{2}[AP]M)\s+ET/);
  if (match) return { start: match[1], end: match[2] };
  return { start: '—', end: '—' };
}

export async function GET() {
  try {
    const aligned = getAlignedTimestamp();
    const slugs = [
      { slug: `btc-updown-5m-${aligned}`, asset: 'BTC' as const },
      { slug: `eth-updown-5m-${aligned}`, asset: 'ETH' as const },
    ];

    // Also try previous 5m window in case current hasn't started
    const prevAligned = aligned - 300;
    slugs.push(
      { slug: `btc-updown-5m-${prevAligned}`, asset: 'BTC' as const },
      { slug: `eth-updown-5m-${prevAligned}`, asset: 'ETH' as const },
    );

    const results: MarketData[] = [];
    const seen = new Set<string>();

    await Promise.all(
      slugs.map(async ({ slug, asset }) => {
        try {
          const res = await fetch(
            `https://gamma-api.polymarket.com/markets?slug=${slug}`,
            { next: { revalidate: 0 }, signal: AbortSignal.timeout(8000) }
          );
          if (!res.ok) return;
          const markets = await res.json();
          if (!markets || markets.length === 0) return;

          const m = markets[0];
          const key = `${asset}-${m.slug}`;
          if (seen.has(key)) return;
          seen.add(key);

          const prices = JSON.parse(m.outcomePrices || '["0.5","0.5"]');
          const { start, end } = parseTimeFromQuestion(m.question || '');

          results.push({
            slug: m.slug,
            question: m.question,
            asset,
            timeframe: '5m',
            upPrice: parseFloat(prices[0]) || 0.5,
            downPrice: parseFloat(prices[1]) || 0.5,
            volume: m.volume ? parseFloat(m.volume) : null,
            startTime: start,
            endTime: end,
            active: m.active ?? true,
          });
        } catch {
          // skip failed fetch
        }
      })
    );

    // Sort: current window first, BTC before ETH
    results.sort((a, b) => {
      if (a.asset !== b.asset) return a.asset === 'BTC' ? -1 : 1;
      return b.slug.localeCompare(a.slug); // newer timestamp first
    });

    // Deduplicate per asset — keep only latest
    const deduped: MarketData[] = [];
    const assetSeen = new Set<string>();
    for (const r of results) {
      if (!assetSeen.has(r.asset)) {
        assetSeen.add(r.asset);
        deduped.push(r);
      }
    }

    return NextResponse.json({
      markets: deduped,
      timestamp: Date.now(),
      aligned,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch markets', markets: [] },
      { status: 500 }
    );
  }
}
