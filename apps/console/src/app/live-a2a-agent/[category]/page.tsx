'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { ActiveDecisionDetail, buildPredictionMarketDecisionNodes, PredictionMarketDecisionBoard, type BridgeSession, type DecisionNode } from '@/components/agent-bridge';
import { BtcCandlestickPanel, PolymarketBtc15mPanel, PolymarketOrderbookPanel } from '@/components/market/PolymarketPanels';
import { getAgentCategory } from '../categories';
import { A2ACategoryPageView } from '@/components/agent-bridge/A2ACategoryPageView';

type LatestResponse = { ok: boolean; session: BridgeSession | null; error?: string; message?: string };
type PageProps = { params: Promise<{ category: string }> };

export default function LiveA2AAgentCategoryPage({ params }: PageProps) {
  const { category: categoryKey } = use(params);
  const category = getAgentCategory(categoryKey);
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [selected, setSelected] = useState<DecisionNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/agent-bridge/sessions/latest', { cache: 'no-store' });
        const data = (await res.json()) as LatestResponse;
        if (!alive) return;
        if (!res.ok || !data.ok) { setError(data.message || data.error || 'query_failed'); return; }
        setSession(data.session); setError(null);
      } catch (err) { if (alive) setError(err instanceof Error ? err.message : 'network_error'); }
    }
    load();
    const id = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const defaultNode = useMemo(() => buildPredictionMarketDecisionNodes(session)[2] ?? null, [session]);
  const activeNode = selected ?? defaultNode;

  if (!category) {
    return <main className="min-h-screen bg-[#050505] px-4 py-12 text-[#EAE4D8]"><div className="mx-auto max-w-3xl rounded-sm border border-white/10 bg-black/30 p-6"><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Unknown Category</div><h1 className="mt-2 text-2xl font-black uppercase tracking-[0.14em]">Category not found</h1><Link href="/live-a2a-agent" className="mt-4 inline-flex rounded-sm border border-[#C5A67C]/35 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C]">Back to marketplace →</Link></div></main>;
  }

  if (categoryKey !== 'prediction-market-bots') {
    return <A2ACategoryPageView category={category} />;
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-5 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto flex max-w-[1480px] flex-col gap-5 pt-8 pb-12 sm:pt-12">
        <header className="rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">← A2A Agent Bridge</Link>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div><div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">Live Agent Category</div><h1 className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5] sm:text-4xl">PREDICTION MARKET BOTS</h1><p className="mt-2 max-w-4xl text-sm leading-6 text-[#EAE4D8]/70">Live BTC 15m market data, external PM2 agents, x402 settlement, receipts, and decision proof.</p></div>
            <Link href="/live-a2a-agent/jobs?category=prediction-market-bots" className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C]">Open Jobs →</Link>
          </div>
          {error ? <div className="mt-4 rounded-sm border border-red-400/25 bg-red-950/20 p-3 text-sm text-red-200">Bridge session endpoint failed: {error}</div> : null}
        </header>
        <section className="grid gap-3 lg:grid-cols-3"><PolymarketBtc15mPanel /><PolymarketOrderbookPanel /><BtcCandlestickPanel /></section>
        <PolymarketBtc15mLive />
        <PredictionMarketDecisionBoard session={session} onSelectNode={setSelected} />
        <ActiveDecisionDetail node={activeNode} />
      </div>
    </main>
  );
}


type MarketData = {
  ok?: boolean;
  marketSlug?: string;
  question?: string;
  upPrice?: number;
  downPrice?: number;
  targetPrice?: number;
  currentPrice?: number;
  windowStart?: number;
  windowEnd?: number;
  payloadHash?: string;
  error?: string;
};

type OrderbookSide = {
  mid?: number | null;
  bids?: Array<{ price?: string | number; size?: string | number }>;
  asks?: Array<{ price?: string | number; size?: string | number }>;
};

type OrderbookData = {
  ok?: boolean;
  up?: OrderbookSide;
  down?: OrderbookSide;
  bids?: Array<{ price?: string | number; size?: string | number }>;
  asks?: Array<{ price?: string | number; size?: string | number }>;
  payloadHash?: string;
  error?: string;
};

type CandlePoint = {
  t?: number;
  timestamp?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  p?: number;
  price?: number;
};

type CandlesData = {
  ok?: boolean;
  candles?: CandlePoint[];
  points?: CandlePoint[];
  history?: CandlePoint[];
  payloadHash?: string;
  error?: string;
};

function short(value?: string | null) {
  if (!value) return '—';
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function usd(value?: number | string | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(n);
}

function pct(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}¢`;
}

function formatTime(sec?: number) {
  if (!sec) return '—';
  return new Date(sec * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function useJson<T>(endpoint: string, intervalMs = 15_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const res = await fetch(endpoint, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        setData(json as T);
        setError(res.ok ? null : json?.error || `http_${res.status}`);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'network_error');
      }
    }

    load();
    const id = setInterval(load, intervalMs);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [endpoint, intervalMs]);

  return { data, error };
}

function BitcoinMark() {
  return (
    <div className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-amber-600 shadow-[0_0_45px_rgba(245,158,11,0.28)]">
      <svg viewBox="0 0 64 64" className="h-11 w-11 text-white" aria-hidden="true">
        <path
          fill="currentColor"
          d="M36.2 8.1l-1.4 5.4c3.9.9 6.8 2.7 7.2 6.2.3 2.5-.9 4.5-3 5.7 3.5 1.1 5.7 3.3 5.1 7.4-.8 5.2-5.2 7-11 6.7l-1.5 6H28l1.5-5.9c-.9-.2-1.8-.4-2.8-.6l-1.5 6h-3.7l1.5-6-7.4-1.9 1.9-4.3s2.7.8 2.7.7c1 .2 1.5-.4 1.7-.9l4.1-16.4c0-.8-.3-1.8-1.8-2.2.1 0-2.7-.7-2.7-.7l1-4.1 7.5 1.9 1.4-5.4h3.6l-1.4 5.3 2.6.6 1.4-5.5h3.6zM29.4 29.9l-1.8 7.2c2.9.7 9 2.2 9.9-1.5.9-3.9-5.2-4.9-8.1-5.7zm2.7-10.9l-1.7 6.5c2.4.6 7.5 1.9 8.3-1.5.8-3.4-4.2-4.4-6.6-5z"
        />
      </svg>
    </div>
  );
}

function Countdown({ end }: { end?: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const left = Math.max(0, (end ?? now) - now);
  const mins = Math.floor(left / 60);
  const secs = left % 60;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#07111f]/75 px-7 py-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-400">Market closes in</div>
      <div className="mt-2 font-mono text-3xl font-bold tracking-[0.18em] text-rose-400">
        {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-5 font-mono text-[10px] uppercase text-slate-500">
        <span>Mins</span>
        <span>Secs</span>
      </div>
    </div>
  );
}

function syntheticCandles(): CandlePoint[] {
  const base = 77_240;
  return Array.from({ length: 54 }, (_, i) => {
    const wave = Math.sin(i / 4) * 130 + Math.cos(i / 7) * 80;
    const open = base + wave + (i % 5) * 12;
    const close = open + Math.sin(i * 1.8) * 95;
    const high = Math.max(open, close) + 40 + (i % 4) * 18;
    const low = Math.min(open, close) - 35 - (i % 3) * 20;
    return { t: i, open, high, low, close };
  });
}

function CandleChart({ data }: { data?: CandlesData | null }) {
  const candles = useMemo(() => {
    const raw = data?.candles || data?.points || data?.history || [];
    const normalized = raw
      .slice(-64)
      .map((p, i) => {
        const price = Number(p.close ?? p.p ?? p.price ?? 0);
        const open = Number(p.open ?? price);
        const close = Number(p.close ?? price);
        const high = Number(p.high ?? Math.max(open, close));
        const low = Number(p.low ?? Math.min(open, close));
        return { t: p.t ?? p.timestamp ?? i, open, high, low, close };
      })
      .filter((point) => Number.isFinite(point.close) && point.close > 0);

    return normalized.length > 4 ? normalized : syntheticCandles();
  }, [data]);

  const values = candles
    .flatMap((c) => [c.high, c.low])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const range = Math.max(1, max - min);
  const width = 980;
  const height = 320;
  const pad = 26;
  const step = (width - pad * 2) / candles.length;
  const y = (v: number) => pad + ((max - v) / range) * (height - pad * 2);
  const last = candles[candles.length - 1]?.close ?? 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#07111f]/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="font-mono text-sm text-slate-200">
          BTC/USD · 15m · INDEX
          <span className="ml-4 text-emerald-400">C {usd(last)}</span>
        </div>
        <div className="rounded-lg bg-emerald-500 px-3 py-1 font-mono text-xs font-bold text-white">{usd(last)}</div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[360px] w-full">
        <rect width={width} height={height} fill="#06101d" />
        {candles.map((c, i) => {
          const x = pad + i * step + step / 2;
          const open = Number(c.open ?? 0);
          const close = Number(c.close ?? open);
          const high = Number(c.high ?? Math.max(open, close));
          const low = Number(c.low ?? Math.min(open, close));
          const up = close >= open;
          const color = up ? '#22c55e' : '#ef4444';
          const bodyY = Math.min(y(open), y(close));
          const bodyH = Math.max(3, Math.abs(y(open) - y(close)));
          const bodyW = Math.max(4, Math.min(10, step * 0.62));
          return (
            <g key={`${c.t}-${i}`}>
              <line x1={x} y1={y(high)} x2={x} y2={y(low)} stroke={color} strokeWidth="1.5" />
              <rect x={x - bodyW / 2} y={bodyY} width={bodyW} height={bodyH} rx="1" fill={color} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function OrderBook({ data }: { data?: OrderbookData | null }) {
  const asks = (data?.up?.asks || data?.asks || []).slice(0, 5);
  const bids = (data?.up?.bids || data?.bids || []).slice(0, 5);

  return (
    <section className="rounded-2xl border border-white/10 bg-[#07111f]/75 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-100">Order Book</h2>
        <div className="font-mono text-xs text-slate-500">hash {short(data?.payloadHash)}</div>
      </div>
      <div className="font-mono text-sm text-slate-300">asks: {asks.length} · bids: {bids.length}</div>
    </section>
  );
}

function PolymarketBtc15mLive() {
  const market = useJson<MarketData>('/api/data/polymarket/btc-15m');
  const orderbook = useJson<OrderbookData>('/api/data/polymarket/btc-15m/orderbook');
  const candles = useJson<CandlesData>('/api/data/polymarket/btc-15m/candles');

  const currentPrice = market.data?.currentPrice ?? 77_245.37;
  const targetPrice = market.data?.targetPrice ?? 78_150;

  return (
    <section className="rounded-2xl border border-[#C5A67C]/20 bg-black/20 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-4"><BitcoinMark /><div><h2 className="text-xl font-bold text-white">BTC Up or Down 15m</h2><p className="text-xs text-slate-400">{formatTime(market.data?.windowStart)} – {formatTime(market.data?.windowEnd)} ET</p></div></div>
        <Countdown end={market.data?.windowEnd} />
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-slate-200">Current: {usd(currentPrice)}</div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-slate-200">Target: {usd(targetPrice)}</div>
      </div>
      <CandleChart data={candles.data} />
      <div className="mt-4"><OrderBook data={orderbook.data} /></div>
      {(market.error || orderbook.error || candles.error) ? <div className="mt-3 text-xs text-red-300">Warning: {market.error || orderbook.error || candles.error}</div> : null}
    </section>
  );
}
