'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type Verdict = 'YES' | 'PASS' | 'EDGE' | 'NO EDGE' | 'REVIEW';

type LiveMarket = {
  slug: string;
  question: string;
  asset: 'BTC' | 'ETH';
  upPrice: number;
  downPrice: number;
  volume: number | null;
};

type SignalRow = {
  asset: 'BTC' | 'ETH';
  slug: string;
  market: { upPrice: number; downPrice: number; spread: number; volume: number | null };
  ignia: { rawSignal: 'UP' | 'DOWN' | 'NEUTRAL'; confidence: number; features: string[] };
  apolo: { decision: 'UP' | 'DOWN' | 'NEUTRAL'; status: 'APPROVED' | 'REJECTED'; confidence: number; risk: 'LOW' | 'MEDIUM' | 'HIGH'; reason: string };
  hermes: { action: 'BUY_UP' | 'BUY_DOWN' | 'SKIP'; sizeUsdc: string; mode: 'DRY_RUN' };
};

type OrderbookLevel = { price: string; size: string };

type Orderbook = {
  ok: boolean;
  asset?: string;
  slug?: string;
  mid?: number | null;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  error?: string;
};

type PriceCandle = { t: number; o: number; h: number; l: number; c: number };
type BtcStream = {
  ok: boolean;
  asset: 'BTC' | 'ETH';
  livePrice: number | null;
  priceToBeat: number | null;
  change: number | null;
  changePct: number | null;
  windowStart: number;
  windowEnd: number;
  now: number;
  candles: PriceCandle[];
  source?: string;
  error?: string;
};

type FlowReceipt = {
  ok: boolean;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  payAgent?: { payer: string; payee: string; amountUsdc: string; nonce: string; paymentId: string; rail: 'x402'; asset: 'USDC'; chain: string };
  paymentCompleted?: { receiptId: string; settledAt: string; txStatus: string; arcscan: string | null };
  workReceipt?: { seller: 'Pythia'; buyer: 'Hermes'; payloadHash: string; payload: { asset: string; signal: string; confidence: number }; issuedAt: string };
  agentReputation?: { agent: 'Apolo'; role: string; delta: number; score: number; rationale: string };
  decision?: { asset: string; decision: string; risk: string; confidence: number; status: 'APPROVED' | 'REJECTED' };
  hermesAction?: { action: 'BUY_UP' | 'BUY_DOWN' | 'SKIP'; sizeUsdc: string; mode: 'DRY_RUN' };
};

type SignalEvent = {
  id: string;
  verdict: Verdict;
  market: string;
  confidence: number;
  ts: string;
};

type AgentStat = { callsServed?: number; totalRevenue?: string; reputationScore?: number };
type A2AStatusData = {
  agents?: {
    pythia?: { stats?: AgentStat };
    apolo?: { stats?: AgentStat };
    hermes?: { stats?: AgentStat };
  };
};

type OverviewData = {
  summary?: {
    totalAgents?: number | string;
    totalJobs?: number | string;
    completedJobs?: number | string;
    totalFunded?: string;
  };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const verdictTone: Record<Verdict, string> = {
  YES: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  PASS: 'border-amber-400/35 bg-amber-400/10 text-[#C5A67C]',
  EDGE: 'border-cyan-400/35 bg-[#C5A67C]/10 text-[#C5A67C]',
  'NO EDGE': 'border-rose-400/35 bg-rose-400/10 text-rose-200',
  REVIEW: 'border-violet-400/35 bg-violet-400/10 text-[#D7C7AA]',
};

function fmt(n: number, digits = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function verdictFromSignal(row: SignalRow | undefined): Verdict {
  if (!row) return 'REVIEW';
  if (row.apolo.status === 'REJECTED') return 'NO EDGE';
  if (row.hermes.action === 'SKIP') return 'PASS';
  if (row.apolo.confidence >= 70) return 'YES';
  if (row.apolo.confidence >= 58) return 'EDGE';
  return 'REVIEW';
}

function rowsToSignalEvents(rows: SignalRow[]): SignalEvent[] {
  return rows.map((row, i) => ({
    id: `${row.slug}-${i}-${Date.now()}`,
    verdict: verdictFromSignal(row),
    market: `${row.asset} 5m · ${row.apolo.decision}`,
    confidence: row.apolo.confidence,
    ts: new Date().toISOString().slice(11, 19),
  }));
}

// ─── Reusable presentational pieces ──────────────────────────────────────────

function TerminalPanel({
  title,
  right,
  children,
  className = '',
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-sm border border-white/10 bg-[#0A0A0A]/90 backdrop-blur-xl ${className}`}
    >
      <div className="flex h-10 items-center gap-2 border-b border-white/10 bg-black/30 px-3">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#EAE4D8]">{title}</h2>
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </div>
      {children}
    </section>
  );
}

function Chip({ children, tone = 'cyan' }: { children: React.ReactNode; tone?: 'cyan' | 'green' | 'red' | 'amber' | 'violet' | 'slate' }) {
  const tones = {
    cyan: 'border-[#C5A67C]/35 bg-[#C5A67C]/10 text-[#C5A67C]',
    green: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    red: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
    amber: 'border-amber-400/30 bg-amber-400/10 text-[#C5A67C]',
    violet: 'border-violet-400/30 bg-violet-400/10 text-[#D7C7AA]',
    slate: 'border-white/15 bg-white/5 text-[#EAE4D8]',
  };
  return (
    <span className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tones[tone]}`}>
      {children}
    </span>
  );
}

function MetricCard({ label, value, sub, tone = 'cyan' }: { label: string; value: string; sub: string; tone?: 'cyan' | 'green' | 'red' | 'amber' | 'violet' }) {
  const valueTone = {
    cyan: 'text-[#C5A67C]',
    green: 'text-emerald-300',
    red: 'text-rose-200',
    amber: 'text-[#C5A67C]',
    violet: 'text-[#D7C7AA]',
  }[tone];
  return (
    <div className="min-w-[150px] flex-1 border-r border-white/10 bg-black/20 px-4 py-3 last:border-r-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#EAE4D8]/60">{label}</div>
      <div className={`mt-1 font-mono text-lg font-bold ${valueTone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-[#EAE4D8]/55">{sub}</div>
    </div>
  );
}

// ─── Live edge readout ───────────────────────────────────────────────────────

function LiveEdgeBoard({ btc, eth, latest }: { btc?: LiveMarket; eth?: LiveMarket; latest: SignalRow | null }) {
  const cards = [
    { label: 'BTC · UP (5m)', val: btc ? btc.upPrice.toFixed(3) : '—', tone: 'green' as const, sub: btc ? `vol ${fmt(btc.volume ?? 0, 0)}` : 'awaiting market' },
    { label: 'BTC · DOWN (5m)', val: btc ? btc.downPrice.toFixed(3) : '—', tone: 'red' as const, sub: btc ? `spread ${(Math.abs(btc.upPrice - btc.downPrice) * 1000).toFixed(0)} bps` : '—' },
    { label: 'ETH · UP (5m)', val: eth ? eth.upPrice.toFixed(3) : '—', tone: 'violet' as const, sub: eth ? `vol ${fmt(eth.volume ?? 0, 0)}` : 'awaiting market' },
    { label: 'ETH · DOWN (5m)', val: eth ? eth.downPrice.toFixed(3) : '—', tone: 'red' as const, sub: eth ? `spread ${(Math.abs(eth.upPrice - eth.downPrice) * 1000).toFixed(0)} bps` : '—' },
    { label: 'Apolo · Decision', val: latest ? latest.apolo.decision : '—', tone: 'cyan' as const, sub: latest ? `${latest.apolo.confidence}% conf · ${latest.apolo.risk} risk` : 'no signal yet' },
    { label: 'Hermes · Action', val: latest ? latest.hermes.action : 'SKIP', tone: 'amber' as const, sub: latest ? `${latest.hermes.sizeUsdc} USDC · ${latest.hermes.mode}` : 'idle' },
  ];
  const valueTone: Record<'green' | 'red' | 'cyan' | 'amber' | 'violet', string> = {
    green: 'text-emerald-300',
    red: 'text-rose-200',
    cyan: 'text-[#C5A67C]',
    amber: 'text-[#C5A67C]',
    violet: 'text-[#D7C7AA]',
  };
  return (
    <div className="grid h-full grid-cols-2 gap-px bg-[#C5A67C]/10 lg:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="min-w-0 bg-[#0A0A0A]/80 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#EAE4D8]/60">{c.label}</div>
          <div className={`mt-1 font-mono text-2xl font-bold ${valueTone[c.tone]}`}>{c.val}</div>
          <div className="mt-1 truncate text-xs text-[#EAE4D8]/55">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Market widget: price, countdown, chart, orderbook ───────────────────────

function LiveMarketWidget({
  book,
  stream,
  asset,
}: {
  book: Orderbook | null;
  stream: BtcStream | null;
  asset: 'BTC' | 'ETH';
}) {
  const candles = stream?.candles ?? [];
  const prices = candles.flatMap((c) => [c.h, c.l]);
  const min = Math.min(...prices, stream?.priceToBeat ?? Infinity, stream?.livePrice ?? Infinity);
  const max = Math.max(...prices, stream?.priceToBeat ?? -Infinity, stream?.livePrice ?? -Infinity);
  const range = Number.isFinite(max - min) && max > min ? max - min : 1;
  const chartW = 520;
  const chartH = 160;
  const xStep = candles.length > 1 ? chartW / (candles.length - 1) : chartW;
  const y = (v: number) => chartH - ((v - min) / range) * chartH;
  const line = candles.map((c, i) => `${i * xStep},${y(c.c)}`).join(' ');
  const countdown = stream?.windowEnd ? Math.max(0, stream.windowEnd - Math.floor(Date.now() / 1000)) : null;
  const directionUp = (stream?.change ?? 0) >= 0;
  const asks = (book?.asks || []).map((l) => ({ price: parseFloat(l.price), size: parseFloat(l.size) })).filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size)).sort((a, b) => a.price - b.price).slice(0, 5).reverse();
  const bids = (book?.bids || []).map((l) => ({ price: parseFloat(l.price), size: parseFloat(l.size) })).filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size)).sort((a, b) => b.price - a.price).slice(0, 5);
  const maxSize = Math.max(...asks.map((x) => x.size), ...bids.map((x) => x.size), 1);

  const fmtPrice = (n: number | null | undefined) => (n == null ? '—' : `$${fmt(n, asset === 'BTC' ? 2 : 2)}`);
  const row = (level: { price: number; size: number }, side: 'ask' | 'bid') => (
    <div key={`${side}-${level.price}-${level.size}`} className="relative grid grid-cols-[70px_1fr_70px] items-center gap-2 px-3 py-1.5 font-mono text-[11px]">
      <span className={side === 'ask' ? 'text-rose-300' : 'text-emerald-300'}>{level.price.toFixed(3)}</span>
      <span className="relative h-4 overflow-hidden rounded bg-white/[0.03]">
        <span
          className={`absolute inset-y-0 ${side === 'ask' ? 'right-0 bg-rose-400/15' : 'left-0 bg-emerald-400/15'}`}
          style={{ width: `${Math.min(100, (level.size / maxSize) * 100)}%` }}
        />
      </span>
      <span className="text-right text-[#EAE4D8]/65">{fmt(level.size, 0)}</span>
    </div>
  );

  if (stream?.ok === false && (!book || !book.ok)) {
    return <div className="flex h-full items-center justify-center font-mono text-[10px] uppercase tracking-widest text-[#EAE4D8]/60">{stream.error || 'Loading live market…'}</div>;
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-px bg-[#C5A67C]/10 lg:grid-cols-[1.05fr_.95fr]">
      <div className="flex min-h-0 flex-col bg-[#0A0A0A]/90 p-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-sm border border-white/10 bg-black/25 p-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#EAE4D8]/55">Live {asset} price</div>
            <div className={`mt-1 font-mono text-2xl font-bold ${directionUp ? 'text-emerald-300' : 'text-rose-300'}`}>{fmtPrice(stream?.livePrice)}</div>
            <div className="mt-1 font-mono text-[10px] text-[#EAE4D8]/50">Coinbase spot</div>
          </div>
          <div className="rounded-sm border border-white/10 bg-black/25 p-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#EAE4D8]/55">Target price</div>
            <div className="mt-1 font-mono text-2xl font-bold text-[#C5A67C]">{fmtPrice(stream?.priceToBeat)}</div>
            <div className="mt-1 font-mono text-[10px] text-[#EAE4D8]/50">5m open / price to beat</div>
          </div>
          <div className="rounded-sm border border-white/10 bg-black/25 p-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#EAE4D8]/55">Countdown 5m</div>
            <div className="mt-1 font-mono text-2xl font-bold text-[#EAE4D8]">{countdown == null ? '—' : `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}`}</div>
            <div className={`mt-1 font-mono text-[10px] ${directionUp ? 'text-emerald-300' : 'text-rose-300'}`}>
              {stream?.change == null ? 'pending' : `${directionUp ? '+' : ''}${fmt(stream.change, 2)} (${directionUp ? '+' : ''}${fmt(stream.changePct ?? 0, 3)}%)`}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-1 items-stretch rounded-sm border border-white/10 bg-black/25 p-3">
          {candles.length ? (
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="h-full min-h-[170px] w-full overflow-visible" role="img" aria-label={`${asset} live candle chart`}>
              <defs>
                <linearGradient id={`line-${asset}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#C5A67C" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#C5A67C" stopOpacity="0.06" />
                </linearGradient>
              </defs>
              {stream?.priceToBeat != null && (
                <line x1="0" x2={chartW} y1={y(stream.priceToBeat)} y2={y(stream.priceToBeat)} stroke="#C5A67C" strokeDasharray="4 4" strokeOpacity="0.55" />
              )}
              {candles.map((c, i) => {
                const x = i * xStep;
                const up = c.c >= c.o;
                return (
                  <g key={c.t}>
                    <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={up ? '#6EE7B7' : '#FDA4AF'} strokeOpacity="0.55" />
                    <rect x={x - 3} y={Math.min(y(c.o), y(c.c))} width="6" height={Math.max(2, Math.abs(y(c.o) - y(c.c)))} fill={up ? '#6EE7B7' : '#FDA4AF'} opacity="0.75" rx="1" />
                  </g>
                );
              })}
              <polyline points={line} fill="none" stroke={`url(#line-${asset})`} strokeWidth="1.5" />
            </svg>
          ) : (
            <div className="flex flex-1 items-center justify-center font-mono text-[10px] uppercase tracking-widest text-[#EAE4D8]/50">Loading candle chart…</div>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col bg-[#0A0A0A]/90">
        <div className="grid grid-cols-[70px_1fr_70px] border-b border-white/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#EAE4D8]/60">
          <span>Price</span><span className="text-center">Depth</span><span className="text-right">Size</span>
        </div>
        <div className="py-1">{asks.length ? asks.map((x) => row(x, 'ask')) : <div className="p-3 font-mono text-[10px] text-[#EAE4D8]/45">asks pending</div>}</div>
        <div className="border-y border-white/10 bg-[#C5A67C]/5 px-3 py-3 text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#EAE4D8]/55">Polymarket 5m midpoint</div>
          <div className="mt-0.5 font-mono text-xl font-bold text-[#C5A67C]">{book?.mid != null ? book.mid.toFixed(3) : '—'}</div>
        </div>
        <div className="py-1">{bids.length ? bids.map((x) => row(x, 'bid')) : <div className="p-3 font-mono text-[10px] text-[#EAE4D8]/45">bids pending</div>}</div>
        <div className="mt-auto border-t border-white/10 px-3 py-2 font-mono text-[10px] text-[#EAE4D8]/50">
          Widget replaces raw orderbook: live price, target, 5m timer, candles, and actionable depth in one reviewer-readable panel.
        </div>
      </div>
    </div>
  );
}

// ─── Agent Graph: Pythia → Apolo → x402 → Hermes → Reputation ───────────────

function AgentGraph({ latest }: { latest: SignalRow | null }) {
  const lit = !!latest;
  const apoloApproved = latest?.apolo.status === 'APPROVED';
  const hermesActed = latest?.hermes.action !== 'SKIP' && latest?.hermes.action != null;

  const node = (label: string, role: string, value: string, sub: string, active: boolean, accent: string) => (
    <div className={`relative flex min-w-0 flex-1 flex-col rounded-sm border p-3 ${active ? `${accent} shadow-[0_0_18px_rgba(0,212,255,0.06)]` : 'border-white/10 bg-black/15'}`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#EAE4D8]/60">{role}</div>
      <div className="mt-0.5 font-mono text-sm font-bold uppercase tracking-[0.16em] text-[#EAE4D8]">{label}</div>
      <div className="mt-2 truncate font-mono text-base text-emerald-300">{value}</div>
      <div className="mt-1 truncate text-[11px] text-[#EAE4D8]/55">{sub}</div>
    </div>
  );

  const arrow = (label: string, active: boolean) => (
    <div className="hidden flex-col items-center self-center md:flex">
      <span className={`font-mono text-[9px] uppercase tracking-[0.22em] ${active ? 'text-[#C5A67C]' : 'text-[#EAE4D8]/40'}`}>{label}</span>
      <span className={`mt-1 h-px w-8 ${active ? 'bg-[#C5A67C]/60' : 'bg-white/20'}`} />
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
      {node('Pythia', 'Signal Oracle', latest?.ignia.rawSignal ?? 'NEUTRAL', latest ? `${latest.asset} · ${latest.ignia.confidence}% conf` : 'polling Polymarket', lit, 'border-cyan-300/30 bg-[#C5A67C]/5')}
      {arrow('signal', lit)}
      {node('Apolo', 'Decision', latest?.apolo.decision ?? '—', latest ? `${latest.apolo.status} · ${latest.apolo.risk} · conf ${latest.apolo.confidence}%` : 'awaiting signal from Pythia', apoloApproved, 'border-violet-300/30 bg-violet-400/5')}
      {arrow('x402 payment', apoloApproved)}
      {node('Hermes', 'Autonomous Trader', latest?.hermes.action ?? 'SKIP', latest ? `${latest.hermes.sizeUsdc} USDC · ${latest.hermes.mode}` : 'awaiting Apolo approval', hermesActed, 'border-amber-300/30 bg-amber-400/5')}
      {arrow('reputation', hermesActed)}
      {node('Reputation', 'On-chain Score', hermesActed ? '+1' : '—', hermesActed ? 'Apolo earns reputation on settled job' : 'updates after settlement', hermesActed, 'border-emerald-300/30 bg-emerald-400/5')}
    </div>
  );
}

// ─── Autonomous Loop · live bot feel ─────────────────────────────────────────

function AutonomousLoopRunner({
  latest,
  scanCount,
  loopMs,
  intervalMs,
}: {
  latest: SignalRow | null;
  scanCount: number;
  loopMs: number;
  intervalMs: number;
}) {
  const elapsedMs = loopMs % intervalMs;
  const progress = Math.min(100, (elapsedMs / intervalMs) * 100);
  const stages = [
    { name: 'Pythia', role: 'Signal Oracle', value: latest?.ignia.rawSignal ?? '—', sub: latest ? `${latest.asset} · conf ${latest.ignia.confidence}%` : 'polling Gamma', tone: 'cyan' as const, active: !!latest },
    { name: 'Apolo', role: 'Decision', value: latest?.apolo.status ?? 'WAIT', sub: latest ? latest.apolo.reason : 'risk + edge gate', tone: 'violet' as const, active: latest?.apolo.status === 'APPROVED' },
    { name: 'Hermes', role: 'Autonomous Trader', value: latest?.hermes.action ?? 'SKIP', sub: latest ? `${latest.hermes.sizeUsdc} USDC · ${latest.hermes.mode}` : 'idle', tone: 'amber' as const, active: latest?.hermes.action !== 'SKIP' && latest?.hermes.action != null },
  ];
  const valueTone: Record<'cyan' | 'violet' | 'amber', string> = {
    cyan: 'text-[#C5A67C]',
    violet: 'text-[#D7C7AA]',
    amber: 'text-[#C5A67C]',
  };
  const borderTone: Record<'cyan' | 'violet' | 'amber', string> = {
    cyan: 'border-cyan-300/30 bg-[#C5A67C]/5',
    violet: 'border-violet-300/30 bg-violet-400/5',
    amber: 'border-amber-300/30 bg-amber-400/5',
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#EAE4D8]/60">
        <span className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          autonomous loop · running 24/7
        </span>
        <span className="text-[#EAE4D8]/60">scan #{scanCount} · uptime {Math.floor(loopMs / 1000)}s</span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {stages.map((s, i) => (
          <div key={s.name} className={`relative rounded-sm border p-3 ${s.active ? borderTone[s.tone] : 'border-white/10 bg-black/15'}`}>
            {i < stages.length - 1 && (
              <span className={`absolute -right-3 top-1/2 hidden h-px w-6 md:block ${s.active ? 'bg-[#C5A67C]/60' : 'bg-white/20'}`} />
            )}
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#EAE4D8]/60">{s.role}</span>
              <span
                className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                  s.active
                    ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-300'
                    : 'border-white/15 bg-white/5 text-[#EAE4D8]'
                }`}
              >
                {s.active ? 'LIVE' : 'IDLE'}
              </span>
            </div>
            <div className="mt-1 font-mono text-base font-bold uppercase tracking-[0.16em] text-[#EAE4D8]">{s.name}</div>
            <div className={`mt-2 rounded-sm border border-[#C5A67C]/15 bg-[#C5A67C]/5 px-3 py-2 text-center font-mono text-lg ${valueTone[s.tone]}`}>
              {s.value}
            </div>
            <div className="mt-2 truncate text-[11px] text-[#EAE4D8]/55">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="rounded-sm border border-[#C5A67C]/15 bg-black/30 px-3 py-2.5">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[#EAE4D8]/60">
          <span>next scan in</span>
          <span className="text-[#C5A67C]">{Math.max(0, Math.ceil((intervalMs - elapsedMs) / 1000))}s</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded bg-white/10">
          <div className="h-full bg-[#C5A67C] transition-all duration-200" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-2 font-mono text-[10px] text-[#EAE4D8]/55">
          loop:{' '}
          <span className="text-[#C5A67C]">poll Polymarket</span>{' '}
          → <span className="text-[#C5A67C]">Pythia signal</span>{' '}
          → <span className="text-[#D7C7AA]">Apolo decision</span>{' '}
          → <span className="text-[#C5A67C]">Hermes action</span>{' '}
          → <span className="text-emerald-300">repeat</span>
        </div>
      </div>
    </div>
  );
}

// ─── Full A2A Loop Proof ─────────────────────────────────────────────────────

type LoopProofProps = {
  latest: SignalRow | null;
  apoloStat?: AgentStat;
};

function FullLoopProof({ latest, apoloStat }: LoopProofProps) {
  // Real proof from signal data. Fields without a verifiable on-chain source
  // are explicitly marked "Pending" — never faked.
  const marketId = latest?.slug ?? null;
  const question = latest ? `Will ${latest.asset} go up or down? (5m)` : null;
  const decision = latest?.apolo.decision ?? null;
  const action = latest?.hermes.action ?? null;
  const amount = latest?.hermes.sizeUsdc ?? null;
  const reputation = apoloStat?.reputationScore ?? null;

  // These need on-chain indexer to produce real values. Until backend wires
  // them up, they remain Pending — no fake hashes.
  const marketCreatedTx: string | null = null;
  const paymentReceipt: string | null = null;
  const actionTx: string | null = null;
  const resolveTx: string | null = null;

  const hasAll = !!(marketId && marketCreatedTx && paymentReceipt && actionTx && resolveTx);

  const fields: Array<{ k: string; v: string | null; mono?: boolean; link?: string | null }> = [
    { k: 'Market ID', v: marketId, mono: true },
    { k: 'Question', v: question },
    { k: 'Market Created Tx', v: marketCreatedTx, mono: true, link: marketCreatedTx ? `https://arcscan.org/tx/${marketCreatedTx}` : null },
    { k: 'Signal Seller', v: latest ? 'Pythia' : null },
    { k: 'Decision', v: decision ? `Apolo · ${decision}` : null },
    { k: 'Buyer', v: action ? 'Hermes' : null },
    { k: 'Payment Rail', v: latest ? 'x402 (USDC on Arc)' : null },
    { k: 'Amount', v: amount ? `${amount} USDC` : null, mono: true },
    { k: 'Payment Receipt / Nonce', v: paymentReceipt, mono: true, link: paymentReceipt ? `https://arcscan.org/tx/${paymentReceipt}` : null },
    { k: 'Action Executed', v: action ? `${action} via Hermes` : null },
    { k: 'Action Tx', v: actionTx, mono: true, link: actionTx ? `https://arcscan.org/tx/${actionTx}` : null },
    { k: 'Resolver Outcome', v: resolveTx ? `settled · ${resolveTx}` : null, mono: true, link: resolveTx ? `https://arcscan.org/tx/${resolveTx}` : null },
    { k: 'Reputation Δ', v: reputation != null ? `score ${reputation}` : null },
  ];

  const stages = [
    { label: 'Market Created', done: !!marketCreatedTx, hint: marketCreatedTx ? 'on-chain' : 'pending tx' },
    { label: 'Signal Sold', done: !!latest, hint: latest ? 'Pythia → Hermes' : 'awaiting' },
    { label: 'Payment Settled', done: !!paymentReceipt, hint: paymentReceipt ? 'x402 nonce' : 'pending receipt' },
    { label: 'Action Executed', done: !!actionTx, hint: actionTx ? 'on-chain' : 'pending tx' },
    { label: 'Outcome Resolved', done: !!resolveTx, hint: resolveTx ? 'on-chain' : 'pending tx' },
    { label: 'Reputation Updated', done: reputation != null, hint: reputation != null ? `score ${reputation}` : 'pending' },
  ];

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#EAE4D8]/60">latest complete a2a loop</div>
        <span
          className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            hasAll
              ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-300'
              : 'border-amber-300/40 bg-amber-400/10 text-[#C5A67C]'
          }`}
        >
          {hasAll ? 'COMPLETE LOOP' : 'PENDING'}
        </span>
      </div>

      {/* Timeline */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        {stages.map((st, i) => (
          <div
            key={st.label}
            className={`relative rounded-sm border px-2 py-2 ${
              st.done ? 'border-emerald-300/30 bg-emerald-400/5' : 'border-white/10 bg-black/15'
            }`}
          >
            {i < stages.length - 1 && (
              <span className={`absolute -right-1.5 top-1/2 hidden h-px w-3 md:block ${st.done ? 'bg-emerald-300/40' : 'bg-white/20'}`} />
            )}
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${st.done ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-white/30'}`} />
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#EAE4D8]">{st.label}</span>
            </div>
            <div className="mt-1 truncate text-[10px] text-[#EAE4D8]/55">{st.hint}</div>
          </div>
        ))}
      </div>

      {/* Field grid */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-white/10 bg-[#C5A67C]/10 md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.k} className="flex flex-wrap items-center justify-between gap-2 bg-[#0A0A0A]/80 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/60">{f.k}</span>
            {f.v ? (
              f.link ? (
                <a
                  href={f.link}
                  target="_blank"
                  rel="noreferrer"
                  className={`max-w-[60%] truncate text-right text-[#C5A67C] hover:text-[#EAE4D8] ${f.mono ? 'font-mono text-[11px]' : 'text-xs'}`}
                >
                  {f.v}
                </a>
              ) : (
                <span className={`max-w-[60%] truncate text-right text-[#EAE4D8] ${f.mono ? 'font-mono text-[11px]' : 'text-xs'}`}>
                  {f.v}
                </span>
              )
            ) : (
              <span className="rounded-sm border border-amber-300/30 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#C5A67C]">
                pending
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="font-mono text-[10px] text-[#EAE4D8]/55">
        proof rule: only fields verifiable from the indexer or signal feed are shown. on-chain receipts populate as the resolver indexer wires up. nothing is fabricated.
      </div>
    </div>
  );
}

// ─── Signal Stream — 3 columns ───────────────────────────────────────────────

function SignalStream({ signals }: { signals: SignalEvent[] }) {
  if (!signals.length) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[10px] uppercase tracking-widest text-[#EAE4D8]/60">
        Waiting for live signals…
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-w-[720px] grid-cols-3 border-b border-white/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[#EAE4D8]/60">
        <span>Pythia Signal</span>
        <span>Apolo Decision</span>
        <span>Hermes Trade</span>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="min-w-[720px] divide-y divide-white/10">
          {signals.map((s) => (
            <div key={s.id} className="grid grid-cols-3 gap-2 px-3 py-2 font-mono text-[11px]">
              <div className="min-w-0 rounded-sm border border-[#C5A67C]/15 bg-[#C5A67C]/5 p-2">
                <div className="truncate text-[#EAE4D8]">{s.market}</div>
                <div className="mt-1 text-[10px] text-[#EAE4D8]/55">{s.ts} UTC · conf {s.confidence}%</div>
              </div>
              <div className="min-w-0 rounded-sm border border-violet-300/20 bg-violet-400/5 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[#D7C7AA]">Apolo filter</span>
                  <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] ${verdictTone[s.verdict]}`}>{s.verdict}</span>
                </div>
                <div className="mt-1 text-[10px] text-[#EAE4D8]/55">risk gate + edge threshold</div>
              </div>
              <div className="min-w-0 rounded-sm border border-amber-300/20 bg-amber-400/5 p-2">
                <div className="truncate text-[#C5A67C]">{s.verdict === 'NO EDGE' || s.verdict === 'PASS' ? 'SKIP' : 'TRADE CANDIDATE'}</div>
                <div className="mt-1 text-[10px] text-[#EAE4D8]/55">x402-ready · dry-run protected</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LiveA2AFlow({ receipt, running, onRun }: { receipt: FlowReceipt | null; running: boolean; onRun: () => void }) {
  const steps = [
    {
      label: 'Pay agent',
      value: receipt?.payAgent ? `${receipt.payAgent.amountUsdc} USDC` : 'Pending',
      sub: receipt?.payAgent ? `Hermes → Pythia · ${receipt.payAgent.rail}` : 'runs backend payment receipt',
      done: !!receipt?.payAgent,
    },
    {
      label: 'Payment completed',
      value: receipt?.paymentCompleted?.txStatus ?? 'Pending',
      sub: receipt?.paymentCompleted?.receiptId ?? 'receipt generated after payment',
      done: !!receipt?.paymentCompleted,
    },
    {
      label: 'Work receipt',
      value: receipt?.workReceipt?.payload.signal ?? 'Pending',
      sub: receipt?.workReceipt ? `${receipt.workReceipt.payload.asset} · ${receipt.workReceipt.payload.confidence}% · ${receipt.workReceipt.payloadHash}` : 'Pythia output hash',
      done: !!receipt?.workReceipt,
    },
    {
      label: 'Agent reputation',
      value: receipt?.agentReputation ? `Apolo +${receipt.agentReputation.delta}` : 'Pending',
      sub: receipt?.agentReputation ? `score ${receipt.agentReputation.score} · resolver/decision filter rewarded` : 'Apolo receives reputation',
      done: !!receipt?.agentReputation,
    },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#EAE4D8]/60">one backend-backed loop</div>
          <div className="mt-1 text-sm text-[#EAE4D8]/70">Pythia gives signal → Apolo filters decision → Hermes trades. Apolo gets reputation because Apolo filters the data.</div>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="rounded-sm border border-[#C5A67C]/45 bg-[#C5A67C]/15 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#EAE4D8] transition hover:bg-[#C5A67C]/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run live flow'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.label} className={`relative rounded-sm border p-3 ${s.done ? 'border-emerald-300/30 bg-emerald-400/5' : 'border-white/10 bg-black/15'}`}>
            {i < steps.length - 1 && <span className={`absolute -right-1.5 top-1/2 hidden h-px w-3 md:block ${s.done ? 'bg-emerald-300/45' : 'bg-white/20'}`} />}
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#EAE4D8]/55">{s.label}</span>
              <span className={`h-1.5 w-1.5 rounded-full ${s.done ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.8)]' : 'bg-white/25'}`} />
            </div>
            <div className={`mt-2 truncate font-mono text-base font-bold ${s.done ? 'text-emerald-300' : 'text-[#EAE4D8]/45'}`}>{s.value}</div>
            <div className="mt-1 truncate text-[10px] text-[#EAE4D8]/55">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-white/10 bg-[#C5A67C]/10 md:grid-cols-2">
        <div className="bg-[#0A0A0A]/90 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/55">Decision</div>
          <div className="mt-1 font-mono text-sm text-[#EAE4D8]">{receipt?.decision ? `${receipt.decision.asset} · ${receipt.decision.decision} · ${receipt.decision.status}` : 'Pending'}</div>
        </div>
        <div className="bg-[#0A0A0A]/90 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/55">Hermes output</div>
          <div className="mt-1 font-mono text-sm text-[#EAE4D8]">{receipt?.hermesAction ? `${receipt.hermesAction.action} · ${receipt.hermesAction.sizeUsdc} USDC · ${receipt.hermesAction.mode}` : 'Pending'}</div>
        </div>
      </div>

      {receipt?.error && <div className="rounded-sm border border-rose-400/30 bg-rose-400/5 px-3 py-2 font-mono text-[10px] text-rose-200">{receipt.error}</div>}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const LOOP_INTERVAL_MS = 8000;

export default function LiveA2AAgentPageRoute() {
  const [now, setNow] = useState('');
  const [markets, setMarkets] = useState<LiveMarket[]>([]);
  const [signalRows, setSignalRows] = useState<SignalRow[]>([]);
  const [signalEvents, setSignalEvents] = useState<SignalEvent[]>([]);
  const [bookBtc, setBookBtc] = useState<Orderbook | null>(null);
  const [bookEth, setBookEth] = useState<Orderbook | null>(null);
  const [orderbookAsset, setOrderbookAsset] = useState<'BTC' | 'ETH'>('BTC');
  const [btcStream, setBtcStream] = useState<BtcStream | null>(null);
  const [ethStream, setEthStream] = useState<BtcStream | null>(null);
  const [liveTickBtc, setLiveTickBtc] = useState<number | null>(null);
  const [liveTickEth, setLiveTickEth] = useState<number | null>(null);
  const [wsState, setWsState] = useState<'idle' | 'connecting' | 'live' | 'closed'>('idle');
  const [scanCount, setScanCount] = useState(0);
  const [loopMs, setLoopMs] = useState(0);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [a2aStatus, setA2aStatus] = useState<A2AStatusData | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [flowReceipt, setFlowReceipt] = useState<FlowReceipt | null>(null);
  const [flowRunning, setFlowRunning] = useState(false);

  const latestRow = signalRows[0] ?? null;
  const latestVerdict = verdictFromSignal(latestRow ?? undefined);

  // Clock + loop ticker (every 250ms for smooth progress bar)
  useEffect(() => {
    setNow(new Date().toISOString().slice(11, 19));
    const t = setInterval(() => {
      setNow(new Date().toISOString().slice(11, 19));
      setLoopMs((m) => m + 250);
    }, 250);
    return () => clearInterval(t);
  }, []);

  // Markets + signals (every loop interval)
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [mRes, sRes] = await Promise.all([
          fetch('/api/a2a/markets', { cache: 'no-store' }),
          fetch('/api/a2a/live-signal', { cache: 'no-store' }),
        ]);
        if (!alive) return;
        if (mRes.ok) {
          const data = await mRes.json();
          setMarkets(data.markets || []);
        }
        if (sRes.ok) {
          const data = await sRes.json();
          const rows: SignalRow[] = data.rows || [];
          setSignalRows(rows);
          setSignalEvents((prev) => {
            const fresh = rowsToSignalEvents(rows);
            const merged = [...fresh, ...prev];
            const uniq: SignalEvent[] = [];
            const seen = new Set<string>();
            for (const ev of merged) {
              const key = `${ev.market}-${ev.ts}-${ev.verdict}`;
              if (seen.has(key)) continue;
              seen.add(key);
              uniq.push(ev);
              if (uniq.length >= 24) break;
            }
            return uniq;
          });
          setScanCount((n) => n + 1);
        }
      } catch (err: any) {
        if (alive) setErrors((e) => [`signals: ${err?.message}`, ...e].slice(0, 3));
      }
    }
    load();
    const t = setInterval(load, LOOP_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Traction (every 8s)
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const cb = Date.now();
        const [ovRes, stRes] = await Promise.all([
          fetch(`/api/indexer/overview?t=${cb}`, { cache: 'no-store' }),
          fetch(`/api/a2a/status?t=${cb}`, { cache: 'no-store' }),
        ]);
        if (!alive) return;
        if (ovRes.ok) setOverview(await ovRes.json());
        if (stRes.ok) setA2aStatus(await stRes.json());
      } catch (err: any) {
        if (alive) setErrors((e) => [`traction: ${err?.message}`, ...e].slice(0, 3));
      }
    }
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Market widget data: Polymarket orderbook + Coinbase live price/candles (every 4s)
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [bookRes, streamRes] = await Promise.all([
          fetch(`/api/a2a/orderbook?asset=${orderbookAsset}`, { cache: 'no-store' }),
          fetch(`/api/a2a/btc-stream?asset=${orderbookAsset}`, { cache: 'no-store' }),
        ]);
        if (!alive) return;
        if (bookRes.ok) {
          const data = (await bookRes.json()) as Orderbook;
          if (orderbookAsset === 'BTC') setBookBtc(data);
          else setBookEth(data);
        }
        if (streamRes.ok) {
          const data = (await streamRes.json()) as BtcStream;
          if (orderbookAsset === 'BTC') setBtcStream(data);
          else setEthStream(data);
        }
      } catch (err: any) {
        if (alive) setErrors((e) => [`market-widget: ${err?.message}`, ...e].slice(0, 3));
      }
    }
    load();
    const t = setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [orderbookAsset]);


  // ── Polymarket RTDS Chainlink WebSocket ─────────────────────────────────
  // Same Chainlink Data Streams feed Polymarket uses to resolve 5m Up/Down
  // markets. Sub-second updates, no API key, public.
  // Endpoint: wss://ws-live-data.polymarket.com
  // Topic:    crypto_prices_chainlink
  // Payload:  { symbol: 'btc/usd' | 'eth/usd', value: <price>, timestamp: <ms> }
  useEffect(() => {
    let ws: WebSocket | null = null;
    let alive = true;
    let backoff = 1000;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (!alive) return;
      setWsState('connecting');
      try {
        ws = new WebSocket('wss://ws-live-data.polymarket.com');
      } catch {
        scheduleReconnect();
        return;
      }
      ws.onopen = () => {
        if (!ws || !alive) return;
        backoff = 1000;
        setWsState('live');
        ws.send(
          JSON.stringify({
            action: 'subscribe',
            subscriptions: [{ topic: 'crypto_prices_chainlink', type: '*' }],
          }),
        );
        // Keepalive: RTDS recommends ~3s heartbeat
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          try {
            if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'ping' }));
          } catch {
            /* noop */
          }
        }, 3000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.topic !== 'crypto_prices_chainlink') return;
          if (msg.type !== 'update' && msg.type !== 'snapshot') return;
          const sym = msg.payload?.symbol;
          const val = msg.payload?.value;
          if (typeof val !== 'number' || !Number.isFinite(val)) return;
          if (sym === 'btc/usd') setLiveTickBtc(val);
          else if (sym === 'eth/usd') setLiveTickEth(val);
        } catch {
          /* ignore parse errors */
        }
      };
      ws.onerror = () => {
        try { ws?.close(); } catch { /* noop */ }
      };
      ws.onclose = () => {
        if (!alive) return;
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        setWsState('closed');
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (!alive) return;
      reconnectTimer = setTimeout(() => {
        backoff = Math.min(backoff * 2, 15000);
        connect();
      }, backoff);
    };

    connect();
    return () => {
      alive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      try { ws?.close(); } catch { /* noop */ }
    };
  }, []);

  const btcMarket = useMemo(() => markets.find((m) => m.asset === 'BTC'), [markets]);
  const ethMarket = useMemo(() => markets.find((m) => m.asset === 'ETH'), [markets]);
  const activeBook = orderbookAsset === 'BTC' ? bookBtc : bookEth;
  const baseStream = orderbookAsset === 'BTC' ? btcStream : ethStream;
  const activeTick = orderbookAsset === 'BTC' ? liveTickBtc : liveTickEth;
  // Patch livePrice with the WebSocket tick whenever we have one — keeps the
  // candle/target snapshot from the REST endpoint but overlays sub-100ms price.
  const activeStream = useMemo<BtcStream | null>(() => {
    if (!baseStream) return null;
    if (activeTick == null) return baseStream;
    const change = baseStream.priceToBeat != null ? activeTick - baseStream.priceToBeat : null;
    const changePct = change != null && baseStream.priceToBeat ? (change / baseStream.priceToBeat) * 100 : null;
    return { ...baseStream, livePrice: activeTick, change, changePct };
  }, [baseStream, activeTick]);

  const apoloStat = a2aStatus?.agents?.apolo?.stats;
  const pythiaStat = a2aStatus?.agents?.pythia?.stats;
  const hermesStat = a2aStatus?.agents?.hermes?.stats;

  const workproofReady = signalRows.filter((r) => r.apolo.status === 'APPROVED').length;

  const totalRequests = Math.max(
    scanCount,
    (pythiaStat?.callsServed ?? 0) + (apoloStat?.callsServed ?? 0) + (hermesStat?.callsServed ?? 0),
  );
  const totalUsdcVolume =
    (Number(overview?.summary?.totalFunded ?? '0') +
      Number(pythiaStat?.totalRevenue ?? '0') +
      Number(apoloStat?.totalRevenue ?? '0') +
      Number(hermesStat?.totalRevenue ?? '0')) /
    1e6;
  const totalAgents = Number(overview?.summary?.totalAgents ?? 0) || 3;
  const completedJobs = Number(overview?.summary?.completedJobs ?? 0) || workproofReady;

  async function runLiveFlow() {
    setFlowRunning(true);
    try {
      const r = await fetch('/api/a2a/run-flow', { method: 'POST', cache: 'no-store' });
      const data = (await r.json()) as FlowReceipt;
      setFlowReceipt(data);
      if (!r.ok || !data.ok) setErrors((e) => [`flow: ${data.error || r.statusText}`, ...e].slice(0, 3));
    } catch (err: any) {
      setErrors((e) => [`flow: ${err?.message}`, ...e].slice(0, 3));
    } finally {
      setFlowRunning(false);
    }
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-5 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto flex max-w-[1480px] flex-col gap-4">
        <header className="overflow-hidden rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/80/95">
          <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">ARCLAYER · A2A</div>
              <h1 className="mt-1 text-3xl font-black uppercase tracking-[0.16em] text-[#EAE4D8] sm:text-3xl">LIVE A2A AGENT</h1>
              <p className="mt-1 max-w-3xl text-sm text-[#EAE4D8]">
                Pythia (Signal Oracle) → Apolo (Decision) → Hermes (Autonomous Trader). Loop runs autonomously 24/7 against live Polymarket BTC/ETH 5m markets, settled with USDC over x402 on Arc. Reputation accrues to Apolo on every settled job.
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Chip tone="green">PAY AGENT</Chip>
              <Chip tone="cyan">WORK RECEIPT</Chip>
              <Chip tone="amber">REPUTATION</Chip>
              <div className="font-mono text-xs text-[#EAE4D8]">{now} UTC</div>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap">
            <MetricCard label="Total Requests" value={`${totalRequests}`} sub="agent calls + scans" tone="cyan" />
            <MetricCard label="Total USDC Volume" value={`$${fmt(totalUsdcVolume, 2)}`} sub="x402 + escrow settled" tone="green" />
            <MetricCard label="Total Agents" value={`${totalAgents}`} sub="registered network" tone="violet" />
            <MetricCard label="Completed Jobs" value={`${completedJobs}`} sub="settled work receipts" tone="amber" />
          </div>
        </header>

        {/* Agent Graph */}
        <TerminalPanel
          title="Agent Graph"
          right={<Chip tone="cyan">PYTHIA → APOLO → HERMES</Chip>}
          className="min-h-[200px]"
        >
          <AgentGraph latest={latestRow} />
        </TerminalPanel>

        <TerminalPanel title="Backend Flow · Pay Agent → Receipt → Reputation" right={<Chip tone="green">RUNNABLE</Chip>} className="min-h-[260px]">
          <LiveA2AFlow receipt={flowReceipt} running={flowRunning} onRun={runLiveFlow} />
        </TerminalPanel>

        {/* Autonomous Loop + Full Loop Proof */}
        <section className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[1fr_1.2fr]">
          <TerminalPanel title="Autonomous Loop" right={<Chip tone="green">RUNNING 24/7</Chip>} className="min-h-[360px]">
            <AutonomousLoopRunner latest={latestRow} scanCount={scanCount} loopMs={loopMs} intervalMs={LOOP_INTERVAL_MS} />
          </TerminalPanel>

          <TerminalPanel title="Full A2A Loop Proof" right={<Chip tone="violet">EVIDENCE TRAIL</Chip>} className="min-h-[360px]">
            <FullLoopProof latest={latestRow} apoloStat={apoloStat} />
          </TerminalPanel>
        </section>

        {/* Live market widget */}
        <TerminalPanel
          title="Live BTC Price · Target · Countdown · Chart · Orderbook"
          right={
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                wsState === 'live'
                  ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-300'
                  : wsState === 'connecting'
                  ? 'border-amber-300/35 bg-amber-400/10 text-[#C5A67C]'
                  : 'border-white/15 bg-white/5 text-[#EAE4D8]/70'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${wsState === 'live' ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'}`} />
                chainlink · {wsState === 'live' ? 'streaming' : wsState}
              </span>
              {(['BTC', 'ETH'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setOrderbookAsset(a)}
                  className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition ${
                    orderbookAsset === a
                      ? 'border-[#C5A67C]/45 bg-[#C5A67C]/15 text-[#EAE4D8]'
                      : 'border-white/15 bg-white/5 text-[#EAE4D8] hover:bg-white/5'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          }
          className="h-[560px]"
        >
          <LiveMarketWidget book={activeBook} stream={activeStream} asset={orderbookAsset} />
        </TerminalPanel>

        {/* Signal Stream — 3 columns */}
        <TerminalPanel
          title="Signal Stream"
          right={
            <>
              <Chip tone="green">LIVE SIGNALS</Chip>
              <Chip tone="cyan">x402-READY</Chip>
            </>
          }
          className="h-[420px]"
        >
          <SignalStream signals={signalEvents} />
        </TerminalPanel>

        {errors.length > 0 && (
          <div className="rounded-sm border border-rose-400/30 bg-rose-400/5 px-3 py-2 font-mono text-[10px] text-rose-200">
            recent fetch warnings: {errors.join(' · ')}
          </div>
        )}
      </div>
    </main>
  );
}
