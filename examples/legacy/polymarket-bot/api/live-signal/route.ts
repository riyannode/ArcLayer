import { NextResponse } from 'next/server';
import { deriveSignalDeterministic, fetchMarket15m, type Asset, type DerivedSignal } from '@/lib/a2a/signal-engine';

type SignalRow = {
  asset: Asset;
  slug: string;
  timeframe: '15m';
  window: string;
  market: {
    upPrice: number;
    downPrice: number;
    spread: number;
    volume: number | null;
  };
  ignia: DerivedSignal['pythia'];
  pythia: DerivedSignal['pythia'];
  apolo: DerivedSignal['apolo'];
  hermes: DerivedSignal['hermes'];
};

function windowLabel(start: number, end: number): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  });
  return `${fmt.format(new Date(start * 1000))}-${fmt.format(new Date(end * 1000))}`;
}

function toRow(signal: DerivedSignal): SignalRow {
  const { market, pythia, apolo, hermes } = signal;
  return {
    asset: market.asset,
    slug: market.slug,
    timeframe: '15m',
    window: windowLabel(market.windowStart, market.windowEnd),
    market: {
      upPrice: market.upPrice,
      downPrice: market.downPrice,
      spread: market.spread,
      volume: market.volume,
    },
    // Keep ignia alias for current frontend compatibility; canonical name is pythia.
    ignia: pythia,
    pythia,
    apolo,
    hermes,
  };
}

export async function GET() {
  try {
    const rows: SignalRow[] = [];
    for (const asset of ['BTC', 'ETH'] as const) {
      const market = await fetchMarket15m(asset);
      if (!market) continue;
      rows.push(toRow(deriveSignalDeterministic(market)));
    }

    return NextResponse.json({
      ok: true,
      timestamp: Date.now(),
      source: 'gamma-api.polymarket.com',
      timeframe: '15m',
      mode: 'live_market_derived_signal',
      rows,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'signal_fetch_failed', rows: [] }, { status: 500 });
  }
}
