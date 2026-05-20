'use client';

import { useEffect, useState } from 'react';

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

interface PriceHistory {
  upHistory: number[];
  downHistory: number[];
  lastSlug: string;
}

const ASSET_COLORS = {
  BTC: { primary: '#F7931A', glow: 'rgba(247,147,26,0.3)' },
  ETH: { primary: '#627EEA', glow: 'rgba(98,126,234,0.3)' },
} as const;

function PriceSparkline({ data, color, width = 120, height = 28 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 0.01;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width, height }} preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MarketCard({ market, history }: { market: MarketData; history: PriceHistory | undefined }) {
  const colors = ASSET_COLORS[market.asset];
  const upPct = (market.upPrice * 100).toFixed(1);
  const downPct = (market.downPrice * 100).toFixed(1);
  const bias = market.upPrice > market.downPrice ? 'UP' : 'DOWN';
  const biasColor = bias === 'UP' ? '#10b981' : '#ef4444';

  return (
    <div
      className="rounded border bg-black/30 p-4 transition-all"
      style={{ borderColor: `${colors.primary}30`, boxShadow: `inset 0 0 24px ${colors.glow}` }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold" style={{ color: colors.primary }}>
            {market.asset}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#bdb1a0]">
            UP/DOWN · 5m
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#9C9080]">
          {market.startTime}–{market.endTime} ET
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded border border-emerald-500/20 bg-emerald-950/[0.08] p-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-300">UP</span>
            <span className="font-mono text-[15px] font-semibold text-emerald-200">{upPct}¢</span>
          </div>
          <PriceSparkline
            data={history?.upHistory ?? [market.upPrice]}
            color="#10b981"
            width={140}
            height={22}
          />
        </div>
        <div className="rounded border border-rose-500/20 bg-rose-950/[0.08] p-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-rose-300">DOWN</span>
            <span className="font-mono text-[15px] font-semibold text-rose-200">{downPct}¢</span>
          </div>
          <PriceSparkline
            data={history?.downHistory ?? [market.downPrice]}
            color="#ef4444"
            width={140}
            height={22}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="text-[#bdb1a0]">bias</span>
          <span style={{ color: biasColor }} className="font-semibold">
            {bias}
          </span>
          <span className="text-[#bdb1a0]">·</span>
          <span className="text-[#d4c4a8]">
            edge {Math.abs(market.upPrice - market.downPrice).toFixed(3)}
          </span>
        </div>
        <a
          href={`https://polymarket.com/event/${market.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#C5A67C] hover:text-[#e8d4b0]"
        >
          polymarket ↗
        </a>
      </div>
      <div className="mt-1 font-mono text-[10px] text-[#9C9080]">
        vol: {market.volume ? `$${market.volume.toFixed(2)}` : '—'} · slug: {market.slug.slice(0, 24)}…
      </div>
    </div>
  );
}

function CountdownTimer() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const next = now + (300 - (now % 300));
      setSecs(next - now);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toString().padStart(2, '0');
  return (
    <span className="font-mono text-[12px] font-semibold text-[#e8d4b0]">
      next 5m · {m}:{s}
    </span>
  );
}

export default function LivePolymarketFeed() {
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [historyMap, setHistoryMap] = useState<Map<string, PriceHistory>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    const fetchMarkets = async () => {
      try {
        const res = await fetch('/api/a2a/markets', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const next: MarketData[] = data.markets || [];
        setMarkets(next);
        setLastUpdate(data.timestamp);
        setError(null);

        // Track history per asset
        setHistoryMap((prev) => {
          const m = new Map(prev);
          for (const market of next) {
            const key = market.asset;
            const existing = m.get(key);
            if (existing && existing.lastSlug === market.slug) {
              m.set(key, {
                upHistory: [...existing.upHistory.slice(-29), market.upPrice],
                downHistory: [...existing.downHistory.slice(-29), market.downPrice],
                lastSlug: market.slug,
              });
            } else {
              // New window — reset history
              m.set(key, {
                upHistory: [market.upPrice],
                downHistory: [market.downPrice],
                lastSlug: market.slug,
              });
            }
          }
          return m;
        });
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'fetch failed');
      }
    };

    fetchMarkets();
    const interval = setInterval(fetchMarkets, 5000); // 5s polling for live feel
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="rounded border border-[#C5A67C]/15 bg-[#C5A67C]/[0.02] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <p className="font-mono text-[11px] uppercase tracking-widest text-[#e8d4b0]">
            live polymarket feed · btc/eth up-down 5m
          </p>
        </div>
        <CountdownTimer />
      </div>

      {error && (
        <div className="mb-3 rounded border border-rose-500/20 bg-rose-950/[0.08] px-3 py-2 font-mono text-[10px] text-rose-300/80">
          feed error: {error} · retrying every 5s
        </div>
      )}

      {markets.length === 0 && !error ? (
        <div className="rounded border border-dashed border-white/10 p-6 text-center">
          <p className="font-mono text-[11px] text-[#bdb1a0]">connecting to gamma-api.polymarket.com…</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {markets.map((m) => (
            <MarketCard key={`${m.asset}-${m.slug}`} market={m} history={historyMap.get(m.asset)} />
          ))}
        </div>
      )}

      <p className="mt-3 font-mono text-[10px] text-[#9C9080] invisible">
        Polled every 5s from{' '}
        <span className="text-[#d4c4a8]">gamma-api.polymarket.com</span>. These are the exact same
        markets Ignia oracle reads to generate signals — Apolo decisions are derived from this raw
        data, then sold to Hermes via x402.
        {lastUpdate > 0 && (
          <>
            {' · '}last update {new Date(lastUpdate).toLocaleTimeString()}
          </>
        )}
      </p>
    </div>
  );
}
