'use client';

import { useEffect, useMemo, useState } from 'react';

type MarketData = {
  ok?: boolean;
  marketSlug?: string;
  question?: string;
  upPrice?: number;
  downPrice?: number;
  spread?: number;
  volume?: number | null;
  windowStart?: number;
  windowEnd?: number;
  payloadHash?: string;
  error?: string;
};

type OrderbookData = {
  ok?: boolean;
  marketSlug?: string;
  up?: { mid?: number | null; bids?: unknown[]; asks?: unknown[] };
  down?: { mid?: number | null; bids?: unknown[]; asks?: unknown[] };
  payloadHash?: string;
  error?: string;
};

type CandlePoint = { t?: number; p?: number; price?: number; timestamp?: number; close?: number };
type CandlesData = { ok?: boolean; points?: CandlePoint[]; history?: CandlePoint[]; candles?: CandlePoint[]; payloadHash?: string; error?: string };

function short(value?: string | null) {
  if (!value) return '—';
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function pct(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function time(value?: number) {
  if (!value) return '—';
  return new Date(value * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function PanelShell({ title, endpoint, children }: { title: string; endpoint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-sm border border-white/10 bg-black/25 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">{title}</div>
        <a href={endpoint} target="_blank" rel="noreferrer" className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#EAE4D8]/45 hover:text-[#C5A67C]">API</a>
      </div>
      {children}
    </section>
  );
}

function useJson<T>(endpoint: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch(endpoint, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || json?.ok === false) setError(json?.error || `HTTP ${res.status}`);
        else setError(null);
        setData(json as T);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'fetch_failed');
      }
    }
    load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [endpoint]);
  return { data, error };
}

export function PolymarketBtc15mPanel() {
  const endpoint = '/api/data/polymarket/btc-15m';
  const { data, error } = useJson<MarketData>(endpoint);
  return (
    <PanelShell title="Polymarket BTC 15m" endpoint={endpoint}>
      {error ? <div className="text-xs text-red-200">{error}</div> : null}
      <div className="grid gap-2 text-xs text-[#EAE4D8]/60">
        <div className="font-mono text-sm text-[#F5F0E5]">{data?.marketSlug || 'loading…'}</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-sm border border-emerald-300/20 bg-emerald-400/10 p-2"><span className="block text-[#EAE4D8]/45">UP</span><span className="font-mono text-emerald-300">{pct(data?.upPrice)}</span></div>
          <div className="rounded-sm border border-red-300/20 bg-red-400/10 p-2"><span className="block text-[#EAE4D8]/45">DOWN</span><span className="font-mono text-red-200">{pct(data?.downPrice)}</span></div>
        </div>
        <div>window: <span className="font-mono text-[#C5A67C]">{time(data?.windowStart)} → {time(data?.windowEnd)}</span></div>
        <div>hash: <span className="font-mono text-[#C5A67C]">{short(data?.payloadHash)}</span></div>
      </div>
    </PanelShell>
  );
}

export function PolymarketOrderbookPanel() {
  const endpoint = '/api/data/polymarket/btc-15m/orderbook';
  const { data, error } = useJson<OrderbookData>(endpoint);
  return (
    <PanelShell title="Orderbook" endpoint={endpoint}>
      {error ? <div className="text-xs text-red-200">{error}</div> : null}
      <div className="grid gap-2 text-xs text-[#EAE4D8]/60">
        {(['up', 'down'] as const).map((side) => (
          <div key={side} className="rounded-sm border border-white/10 bg-white/[0.03] p-2">
            <div className="font-mono uppercase text-[#F5F0E5]">{side}</div>
            <div className="mt-1 grid grid-cols-3 gap-2">
              <span>mid <b className="font-mono text-[#C5A67C]">{pct(data?.[side]?.mid)}</b></span>
              <span>bids <b className="font-mono text-[#C5A67C]">{data?.[side]?.bids?.length ?? 0}</b></span>
              <span>asks <b className="font-mono text-[#C5A67C]">{data?.[side]?.asks?.length ?? 0}</b></span>
            </div>
          </div>
        ))}
        <div>hash: <span className="font-mono text-[#C5A67C]">{short(data?.payloadHash)}</span></div>
      </div>
    </PanelShell>
  );
}

export function BtcCandlestickPanel() {
  const endpoint = '/api/data/polymarket/btc-15m/candles';
  const { data, error } = useJson<CandlesData>(endpoint);
  const points = useMemo(() => (data?.candles || data?.points || data?.history || []).slice(-12), [data]);
  return (
    <PanelShell title="BTC Candlestick" endpoint={endpoint}>
      {error ? <div className="text-xs text-red-200">{error}</div> : null}
      <div className="flex h-20 items-end gap-1 rounded-sm border border-white/10 bg-white/[0.03] p-2">
        {points.length === 0 ? <div className="text-xs text-[#EAE4D8]/45">loading candles…</div> : points.map((point, index) => {
          const price = Number(point.close ?? point.p ?? point.price ?? 0);
          const height = Math.max(12, Math.min(72, price * 72));
          return <div key={`${point.t || point.timestamp || index}`} className="flex-1 bg-[#C5A67C]/70" style={{ height }} title={`${price}`} />;
        })}
      </div>
      <div className="mt-2 font-mono text-[10px] text-[#EAE4D8]/45">points {points.length} · hash <span className="text-[#C5A67C]">{short(data?.payloadHash)}</span></div>
    </PanelShell>
  );
}
