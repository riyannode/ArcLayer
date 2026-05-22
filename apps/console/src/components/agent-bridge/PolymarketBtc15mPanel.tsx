'use client';

import { useEffect, useState } from 'react';
import { shortHash } from './types';

type MarketPayload = {
  ok?: boolean;
  question?: string;
  marketSlug?: string;
  upPrice?: number | string | null;
  downPrice?: number | string | null;
  volume?: number | string | null;
  fetchedAt?: string;
  payloadHash?: string;
  error?: string;
};

function pct(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}¢` : '—';
}

export function PolymarketBtc15mPanel() {
  const [data, setData] = useState<MarketPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/data/polymarket/btc-15m', { cache: 'no-store' });
        const next = await res.json().catch(() => ({}));
        if (!alive) return;
        setData(next);
        setError(res.ok ? null : next?.error || `HTTP ${res.status}`);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'market_fetch_failed');
      }
    }
    load();
    const id = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const up = Number(data?.upPrice);
  const down = Number(data?.downPrice);
  const spread = Number.isFinite(up) && Number.isFinite(down) ? Math.abs(up + down - 1) : null;

  return (
    <section className="rounded-sm border border-[#C5A67C]/20 bg-[#0A0A0A]/90 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Live BTC 15m Market Data</div>
          <h2 className="mt-2 text-xl font-black uppercase tracking-[0.12em] text-[#F5F0E5]">{data?.question || 'Polymarket BTC 15m'}</h2>
          <div className="mt-1 max-w-3xl break-all font-mono text-[10px] text-[#EAE4D8]/45">{data?.marketSlug || 'loading-market'}</div>
        </div>
        <span className="rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] uppercase text-emerald-300">Raw Data Feed</span>
      </div>
      {error ? <div className="mt-3 rounded-sm border border-amber-400/20 bg-amber-950/20 p-3 text-xs text-amber-100">{error}</div> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-5">
        <Metric label="UP price" value={pct(data?.upPrice)} tone="text-emerald-300" />
        <Metric label="DOWN price" value={pct(data?.downPrice)} tone="text-red-300" />
        <Metric label="spread" value={spread == null ? '—' : `${(spread * 100).toFixed(2)}¢`} />
        <Metric label="volume" value={data?.volume == null ? '—' : String(data.volume)} />
        <Metric label="payloadHash" value={shortHash(data?.payloadHash)} />
      </div>
      <div className="mt-3 font-mono text-[10px] text-[#EAE4D8]/45">fetchedAt: {data?.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : '—'}</div>
    </section>
  );
}

function Metric({ label, value, tone = 'text-[#C5A67C]' }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-sm border border-white/10 bg-white/[0.03] p-3"><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#EAE4D8]/40">{label}</div><div className={`mt-1 break-all font-mono text-sm ${tone}`}>{value}</div></div>;
}
