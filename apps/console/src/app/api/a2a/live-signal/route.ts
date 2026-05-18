import { NextResponse } from 'next/server';

type Asset = 'BTC' | 'ETH';
type Direction = 'UP' | 'DOWN' | 'NEUTRAL';
type HermesAction = 'BUY_UP' | 'BUY_DOWN' | 'SKIP';

interface SignalRow {
  asset: Asset;
  slug: string;
  window: string;
  market: {
    upPrice: number;
    downPrice: number;
    spread: number;
    volume: number | null;
  };
  ignia: {
    rawSignal: Direction;
    confidence: number;
    features: string[];
  };
  apolo: {
    decision: Direction;
    status: 'APPROVED' | 'REJECTED';
    confidence: number;
    risk: 'LOW' | 'MEDIUM' | 'HIGH';
    reason: string;
  };
  hermes: {
    action: HermesAction;
    sizeUsdc: string;
    mode: 'DRY_RUN';
  };
}

function alignedTimestamp() {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % 300);
}

function parsePrices(raw: string | undefined): [number, number] {
  try {
    const arr = JSON.parse(raw || '["0.5","0.5"]');
    return [Number(arr[0]) || 0.5, Number(arr[1]) || 0.5];
  } catch {
    return [0.5, 0.5];
  }
}

function windowLabel(question: string) {
  const match = question.match(/-\s*([^,]+,\s*)?(.+)$/);
  return match?.[2] ?? 'current 5m window';
}

function deriveSignal(asset: Asset, market: any): SignalRow {
  const [upPrice, downPrice] = parsePrices(market.outcomePrices);
  const spread = Math.abs(upPrice - downPrice);
  const volume = market.volume ? Number(market.volume) : null;
  const direction: Direction = spread < 0.012 ? 'NEUTRAL' : upPrice > downPrice ? 'UP' : 'DOWN';
  const confidence = Math.min(92, Math.max(50, Math.round(50 + spread * 1000 + Math.min((volume ?? 0) / 250, 12))));
  const risk: 'LOW' | 'MEDIUM' | 'HIGH' = confidence >= 70 ? 'LOW' : confidence >= 58 ? 'MEDIUM' : 'HIGH';
  const approved = direction !== 'NEUTRAL' && confidence >= 56;
  const action: HermesAction = !approved ? 'SKIP' : direction === 'UP' ? 'BUY_UP' : 'BUY_DOWN';

  const features = [
    `${asset} 5m UP/DOWN orderbook midpoint`,
    `UP ${upPrice.toFixed(3)} / DOWN ${downPrice.toFixed(3)}`,
    `micro-edge ${spread.toFixed(3)}`,
    volume ? `volume $${volume.toFixed(2)}` : 'volume pending',
  ];

  return {
    asset,
    slug: market.slug,
    window: windowLabel(market.question || ''),
    market: { upPrice, downPrice, spread, volume },
    ignia: {
      rawSignal: direction,
      confidence,
      features,
    },
    apolo: {
      decision: direction,
      status: approved ? 'APPROVED' : 'REJECTED',
      confidence,
      risk,
      reason: approved
        ? `Edge passed Apolo risk gate; ${direction} probability leads by ${(spread * 100).toFixed(1)} pts.`
        : 'No sufficient 5m edge; resolver rejects execution.',
    },
    hermes: {
      action,
      sizeUsdc: approved ? '0.10' : '0.00',
      mode: 'DRY_RUN',
    },
  };
}

export async function GET() {
  const aligned = alignedTimestamp();
  const prev = aligned - 300;
  const candidates = [
    { asset: 'BTC' as const, slugs: [`btc-updown-5m-${aligned}`, `btc-updown-5m-${prev}`] },
    { asset: 'ETH' as const, slugs: [`eth-updown-5m-${aligned}`, `eth-updown-5m-${prev}`] },
  ];

  try {
    const rows: SignalRow[] = [];
    for (const candidate of candidates) {
      for (const slug of candidate.slugs) {
        const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${slug}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const markets = await res.json();
        if (Array.isArray(markets) && markets.length > 0) {
          rows.push(deriveSignal(candidate.asset, markets[0]));
          break;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      timestamp: Date.now(),
      source: 'gamma-api.polymarket.com',
      mode: 'live_market_derived_signal',
      rows,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'signal_fetch_failed', rows: [] }, { status: 500 });
  }
}
