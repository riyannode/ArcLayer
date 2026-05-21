import { NextResponse } from 'next/server';
import { fetchMarket15m, type Asset } from '@/lib/a2a/signal-engine';

interface MarketData {
  slug: string;
  question: string;
  asset: Asset;
  timeframe: '15m';
  upPrice: number;
  downPrice: number;
  volume: number | null;
  startTime: string;
  endTime: string;
  active: boolean;
}

function formatEt(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(new Date(ts * 1000));
}

export async function GET() {
  try {
    const markets = await Promise.all((['BTC', 'ETH'] as const).map(async (asset) => fetchMarket15m(asset)));
    const deduped: MarketData[] = markets.filter((m): m is NonNullable<typeof m> => Boolean(m)).map((m) => ({
      slug: m.slug,
      question: m.question,
      asset: m.asset,
      timeframe: '15m',
      upPrice: m.upPrice,
      downPrice: m.downPrice,
      volume: m.volume,
      startTime: formatEt(m.windowStart),
      endTime: formatEt(m.windowEnd),
      active: true,
    }));

    return NextResponse.json({
      ok: true,
      markets: deduped,
      timestamp: Date.now(),
      timeframe: '15m',
      aligned: deduped[0]?.slug?.match(/-(\d+)$/)?.[1] ? Number(deduped[0].slug.match(/-(\d+)$/)?.[1]) : null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Failed to fetch markets', markets: [] },
      { status: 500 },
    );
  }
}
