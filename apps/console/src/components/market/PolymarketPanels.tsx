'use client';

import { useEffect, useMemo, useState } from 'react';

type MarketData = { ok?: boolean; marketSlug?: string; upPrice?: number; downPrice?: number; windowStart?: number; windowEnd?: number; payloadHash?: string; error?: string };
type OrderbookData = { ok?: boolean; up?: { mid?: number | null; bids?: unknown[]; asks?: unknown[] }; down?: { mid?: number | null; bids?: unknown[]; asks?: unknown[] }; payloadHash?: string; error?: string };
type CandlePoint = { p?: number; price?: number; close?: number; t?: number; timestamp?: number };
type CandlesData = { ok?: boolean; points?: CandlePoint[]; history?: CandlePoint[]; candles?: CandlePoint[]; payloadHash?: string; error?: string };

function short(value?: string | null) { if (!value) return '—'; return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value; }
function pct(value?: number | null) { if (typeof value !== 'number' || !Number.isFinite(value)) return '—'; return `${(value * 100).toFixed(1)}%`; }
function time(value?: number) { if (!value) return '—'; return new Date(value * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

function PanelShell({ title, endpoint, children }: { title: string; endpoint: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-zinc-800 bg-[#111214] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
    <div className="mb-3 flex items-center justify-between">
      <div>
        <div className="text-[13px] font-semibold text-zinc-100">{title}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">API</div>
      </div>
      <a href={endpoint} target="_blank" rel="noreferrer" className="rounded-md border border-zinc-700 px-2 py-1 font-mono text-[10px] text-zinc-300">Open</a>
    </div>
    {children}
  </section>;
}

function useJson<T>(endpoint: string) { const [data, setData] = useState<T | null>(null); useEffect(() => { let alive = true; async function load() { const res = await fetch(endpoint, { cache: 'no-store' }); const json = await res.json().catch(() => ({})); if (alive) setData(json as T); } load(); const id = setInterval(load, 15000); return () => { alive = false; clearInterval(id); }; }, [endpoint]); return data; }

export function PolymarketBtc15mPanel() {
  const endpoint = '/api/data/polymarket/btc-15m';
  const data = useJson<MarketData>(endpoint);
  const upPrice = typeof data?.upPrice === 'number' && Number.isFinite(data.upPrice) ? data.upPrice : null;
  const downPrice = typeof data?.downPrice === 'number' && Number.isFinite(data.downPrice) ? data.downPrice : null;
  const hasUpPrice = upPrice !== null;
  const hasDownPrice = downPrice !== null;
  const upWidth = upPrice !== null ? `${Math.max(0, Math.min(100, upPrice * 100))}%` : '0%';
  return <PanelShell title="Polymarket BTC 15m" endpoint={endpoint}>
    <div className="font-mono text-xs text-zinc-400">{data?.marketSlug || 'market unavailable'}</div>
    <div className="mt-3 rounded-lg border border-zinc-800 bg-[#0D0E10] p-3">
      <div className="flex h-9 overflow-hidden rounded-md border border-zinc-700">
        <div className="flex items-center justify-center bg-emerald-500/25 text-xs font-semibold text-emerald-300 transition-[width]" style={{ width: upWidth }}>UP {pct(data?.upPrice)}</div>
        <div className="flex-1 bg-red-500/20 text-right text-xs font-semibold text-red-300"><span className="pr-2 leading-9">DOWN {pct(data?.downPrice)}</span></div>
      </div>
      {!hasUpPrice || !hasDownPrice ? <div className="mt-2 text-xs text-amber-300">Live probability unavailable</div> : null}
      <div className="mt-2 text-xs text-zinc-400">window: {time(data?.windowStart)} → {time(data?.windowEnd)}</div>
      <div className="mt-1 font-mono text-xs text-zinc-500">hash: {short(data?.payloadHash)}</div>
    </div>
  </PanelShell>;
}

export function PolymarketOrderbookPanel() {
  const endpoint = '/api/data/polymarket/btc-15m/orderbook';
  const data = useJson<OrderbookData>(endpoint);
  const rows = (['up', 'down'] as const).map((side) => ({ side, mid: pct(data?.[side]?.mid), bids: data?.[side]?.bids?.length ?? 0, asks: data?.[side]?.asks?.length ?? 0 }));
  return <PanelShell title="Orderbook" endpoint={endpoint}>
    <div className="space-y-2">
      {rows.map((r) => <div key={r.side} className="rounded-lg border border-zinc-800 bg-[#0D0E10] p-3">
        <div className="mb-1 font-mono text-[11px] uppercase text-zinc-300">{r.side}</div>
        <div className="grid grid-cols-3 text-xs text-zinc-400"><span>mid <b className="text-zinc-100">{r.mid}</b></span><span>bids <b className="text-emerald-300">{r.bids}</b></span><span>asks <b className="text-red-300">{r.asks}</b></span></div>
      </div>)}
      <div className="font-mono text-xs text-zinc-500">hash: {short(data?.payloadHash)}</div>
    </div>
  </PanelShell>;
}

export function BtcCandlestickPanel() {
  const endpoint = '/api/data/polymarket/btc-15m/candles';
  const data = useJson<CandlesData>(endpoint);
  const points = useMemo(() => (data?.candles || data?.points || data?.history || []).slice(-24), [data]);
  return <PanelShell title="BTC Candlestick" endpoint={endpoint}>
    <div className="rounded-lg border border-zinc-800 bg-[#0D0E10] p-3">
      <div className="flex h-28 items-end gap-1">
        {points.length === 0 ? <div className="self-center text-xs text-zinc-500">No candle points yet</div> : points.map((point, idx) => {
          const price = Number(point.close ?? point.p ?? point.price ?? 0);
          const height = Math.max(8, Math.min(100, price * 100));
          return <div key={`${point.t || point.timestamp || idx}`} className="w-2 rounded-sm bg-cyan-300/80" style={{ height }} />;
        })}
      </div>
      <div className="mt-2 font-mono text-xs text-zinc-500">points {points.length} · hash {short(data?.payloadHash)}</div>
    </div>
  </PanelShell>;
}
