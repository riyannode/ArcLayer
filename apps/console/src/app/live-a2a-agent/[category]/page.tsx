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

function BitcoinMark() { return <div />; }
function Countdown({ end }: { end?: number }) { return <div>{end}</div>; }
function syntheticCandles(): CandlePoint[] { return []; }
function CandleChart({ data }: { data?: CandlesData | null }) { return <div>{data?.ok ? 'ok' : ''}</div>; }
function OrderBook({ data }: { data?: OrderbookData | null }) { return <div>{data?.ok ? 'ok' : ''}</div>; }

function PolymarketBtc15mLive() {
  const market = useJson<MarketData>('/api/data/polymarket/btc-15m');
  const orderbook = useJson<OrderbookData>('/api/data/polymarket/btc-15m/orderbook');
  const candles = useJson<CandlesData>('/api/data/polymarket/btc-15m/candles');

  const currentPrice = market.data?.currentPrice ?? 77_245.37;
  const targetPrice = market.data?.targetPrice ?? 78_150;

  return (
    <section>
      <BitcoinMark />
      <Countdown end={market.data?.windowEnd} />
      <div>{formatTime(market.data?.windowStart)} – {formatTime(market.data?.windowEnd)}</div>
      <div>{usd(currentPrice)} {usd(targetPrice)} {short(orderbook.data?.payloadHash)} {pct(0.5)}</div>
      <CandleChart data={candles.data} />
      <OrderBook data={orderbook.data} />
    </section>
  );
}
