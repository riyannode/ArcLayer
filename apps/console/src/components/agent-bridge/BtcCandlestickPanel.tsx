'use client';

import { useEffect, useMemo, useState } from 'react';
import { shortHash } from './types';

type Candle = { timestamp: number; open: number; high: number; low: number; close: number };
type Payload = { candles?: Candle[]; livePrice?: number | string | null; fetchedAt?: string; payloadHash?: string; error?: string };

export function BtcCandlestickPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    async function load() {
      try { const res = await fetch('/api/data/polymarket/btc-15m/candles', { cache: 'no-store' }); const next = await res.json().catch(() => ({})); if (!alive) return; setData(next); setError(res.ok ? null : next?.error || `HTTP ${res.status}`); }
      catch (err) { if (alive) setError(err instanceof Error ? err.message : 'candles_fetch_failed'); }
    }
    load(); const id = setInterval(load, 15_000); return () => { alive = false; clearInterval(id); };
  }, []);
  const candles = (data?.candles || []).slice(-24);
  const { min, max } = useMemo(() => {
    const vals = candles.flatMap((c) => [Number(c.low), Number(c.high)]).filter(Number.isFinite);
    return { min: Math.min(...vals, 0), max: Math.max(...vals, 1) };
  }, [candles]);
  const y = (v: number) => 132 - ((v - min) / Math.max(0.000001, max - min)) * 112;
  const width = 520;
  const step = width / Math.max(1, candles.length);
  return (
    <section className="rounded-sm border border-white/10 bg-black/25 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Candlestick Chart</div><div className="mt-1 font-mono text-lg text-[#F5F0E5]">BTC {data?.livePrice ?? '—'}</div></div><div className="font-mono text-[10px] text-[#EAE4D8]/45">hash {shortHash(data?.payloadHash)}</div></div>
      {error ? <div className="mb-3 rounded-sm border border-amber-400/20 bg-amber-950/20 p-3 text-xs text-amber-100">{error}</div> : null}
      <div className="overflow-hidden rounded-sm border border-white/10 bg-[#050505] p-2">
        <svg viewBox={`0 0 ${width} 150`} className="h-48 w-full" role="img" aria-label="Last 24 BTC candles">
          <line x1="0" y1="132" x2={width} y2="132" stroke="rgba(234,228,216,.12)" />
          {candles.map((c, i) => { const x = i * step + step / 2; const up = c.close >= c.open; const bodyY = Math.min(y(c.open), y(c.close)); const bodyH = Math.max(2, Math.abs(y(c.open) - y(c.close))); return <g key={`${c.timestamp}-${i}`}><line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={up ? '#6ee7b7' : '#fca5a5'} strokeWidth="1.2" /><rect x={x - Math.max(3, step * 0.24)} y={bodyY} width={Math.max(6, step * 0.48)} height={bodyH} fill={up ? 'rgba(110,231,183,.65)' : 'rgba(252,165,165,.65)'} /></g>; })}
        </svg>
      </div>
      <div className="mt-3 font-mono text-[10px] text-[#EAE4D8]/45">last 24 candles · fetchedAt: {data?.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : '—'}</div>
    </section>
  );
}
