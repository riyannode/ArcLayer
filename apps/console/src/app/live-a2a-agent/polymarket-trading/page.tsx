'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type Asset = 'BTC' | 'ETH';
type Direction = 'UP' | 'DOWN' | 'NEUTRAL';
type HermesAction = 'BUY_UP' | 'BUY_DOWN' | 'SKIP';
type RunStatus = 'PENDING' | 'NO_CHANGE_SKIPPED' | 'WIN' | 'LOSS' | 'PUSH' | 'ERROR';

interface TradeRecord {
  id: string;
  recordedAt: string;
  windowStart: number;
  windowEnd: number;
  asset: Asset;
  marketSlug: string;
  snapshotHash: string;
  pythia: { rawSignal: Direction; confidence: number; features: string[]; reasoning?: string };
  apolo: { decision: Direction; status: 'APPROVED' | 'REJECTED'; confidence: number; risk: 'LOW' | 'MEDIUM' | 'HIGH'; reason: string; reasoning?: string };
  hermes: { action: HermesAction; sizeUsdc: string; mode: 'DRY_RUN' | 'LIVE'; receipts: { service: string; amountUsdc: string; receiptId: string; settlementTxHash: string }[] };
  snapshot: { upPrice: number; downPrice: number; spread: number; volume: number | null };
  reasoningMode: 'deterministic' | 'llm';
  status: RunStatus;
  resolution?: { resolvedAt: string; finalUpPrice: number; finalDownPrice: number; pnlUsdc: number; pnlBps: number; note: string };
  skippedFromId?: string;
  error?: string;
}

interface TradeStats {
  total: number;
  pending: number;
  skipped: number;
  wins: number;
  losses: number;
  pushes: number;
  errors: number;
  hitRate: number;
  totalPnlUsdc: number;
  totalPnlBps: number;
  byAsset: Record<Asset, { wins: number; losses: number; pnlUsdc: number }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number, digits = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

const STATUS_STYLE: Record<RunStatus, string> = {
  PENDING: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  NO_CHANGE_SKIPPED: 'border-zinc-400/20 bg-zinc-400/5 text-zinc-400',
  WIN: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  LOSS: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  PUSH: 'border-violet-400/25 bg-violet-400/8 text-violet-300',
  ERROR: 'border-red-500/30 bg-red-500/10 text-red-300',
};

const ACTION_STYLE: Record<HermesAction, string> = {
  BUY_UP: 'text-emerald-400',
  BUY_DOWN: 'text-rose-400',
  SKIP: 'text-zinc-400',
};

// ─── Components ──────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, tone = 'cyan' }: { label: string; value: string; sub: string; tone?: 'cyan' | 'green' | 'red' | 'amber' | 'violet' }) {
  const colors = { cyan: 'text-[#C5A67C]', green: 'text-emerald-300', red: 'text-rose-300', amber: 'text-amber-300', violet: 'text-violet-300' };
  return (
    <div className="min-w-[140px] flex-1 rounded-sm border border-white/10 bg-[#0A0A0A]/80 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#EAE4D8]/55">{label}</div>
      <div className={`mt-1 font-mono text-xl font-bold ${colors[tone]}`}>{value}</div>
      <div className="mt-0.5 text-xs text-[#EAE4D8]/50">{sub}</div>
    </div>
  );
}

function PnlChart({ trades }: { trades: TradeRecord[] }) {
  // Cumulative PnL line from resolved trades (oldest → newest).
  const resolved = useMemo(() => {
    return trades
      .filter((t) => t.resolution && (t.status === 'WIN' || t.status === 'LOSS'))
      .sort((a, b) => a.windowStart - b.windowStart);
  }, [trades]);

  if (resolved.length < 2) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[10px] text-[#EAE4D8]/40 uppercase tracking-widest">
        awaiting 2+ resolved trades for chart
      </div>
    );
  }

  // Build cumulative series.
  let cum = 0;
  const points = resolved.map((t) => {
    cum += t.resolution!.pnlUsdc;
    return cum;
  });

  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const range = max - min || 1;
  const W = 600;
  const H = 120;
  const stepX = W / (points.length - 1);

  const pathD = points
    .map((y, i) => {
      const px = i * stepX;
      const py = H - ((y - min) / range) * (H - 20) - 10;
      return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');

  const zeroY = H - ((0 - min) / range) * (H - 20) - 10;
  const lastPnl = points[points.length - 1];
  const lineColor = lastPnl >= 0 ? '#10b981' : '#f43f5e';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
      {/* Zero line */}
      <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="#ffffff15" strokeDasharray="4 4" />
      {/* PnL path */}
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* End dot */}
      <circle cx={(points.length - 1) * stepX} cy={H - ((lastPnl - min) / range) * (H - 20) - 10} r="3" fill={lineColor} />
    </svg>
  );
}

function TradeRow({ trade }: { trade: TradeRecord }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-sm border border-white/5 bg-white/[0.015] transition hover:border-white/10">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {/* Status badge */}
        <span className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase ${STATUS_STYLE[trade.status]}`}>
          {trade.status.replace('_', ' ')}
        </span>
        {/* Asset */}
        <span className="font-mono text-sm font-semibold" style={{ color: trade.asset === 'BTC' ? '#F7931A' : '#627EEA' }}>
          {trade.asset}
        </span>
        {/* Direction + action */}
        <span className={`font-mono text-xs font-bold ${ACTION_STYLE[trade.hermes.action]}`}>
          {trade.hermes.action.replace('_', ' ')}
        </span>
        {/* Confidence */}
        <span className="font-mono text-[10px] text-[#EAE4D8]/60">
          conf {trade.apolo.confidence}%
        </span>
        {/* PnL */}
        {trade.resolution && (
          <span className={`ml-auto font-mono text-xs font-bold ${trade.resolution.pnlUsdc >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {trade.resolution.pnlUsdc >= 0 ? '+' : ''}{fmt(trade.resolution.pnlUsdc, 4)} USDC
          </span>
        )}
        {!trade.resolution && (
          <span className="ml-auto font-mono text-[10px] text-[#EAE4D8]/40">
            {timeAgo(trade.recordedAt)}
          </span>
        )}
        {/* Expand arrow */}
        <span className="text-[#EAE4D8]/40 transition" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
      </button>

      {expanded && (
        <div className="border-t border-white/5 px-4 py-3 space-y-2">
          {/* Three-agent pipeline mini */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded border border-cyan-500/15 bg-cyan-950/[0.04] p-2">
              <p className="font-mono text-[8px] uppercase tracking-widest text-cyan-300 mb-1">Pythia</p>
              <p className="font-mono text-sm font-semibold text-[#EAE4D8]">{trade.pythia.rawSignal}</p>
              <p className="font-mono text-[9px] text-[#9C9080]">conf {trade.pythia.confidence}%</p>
              {trade.pythia.reasoning && <p className="mt-1 font-mono text-[9px] text-[#9C9080] leading-tight">{trade.pythia.reasoning}</p>}
            </div>
            <div className="rounded border border-violet-500/15 bg-violet-950/[0.04] p-2">
              <p className="font-mono text-[8px] uppercase tracking-widest text-violet-300 mb-1">Apolo</p>
              <p className="font-mono text-sm font-semibold text-[#EAE4D8]">{trade.apolo.decision} · {trade.apolo.status}</p>
              <p className="font-mono text-[9px] text-[#9C9080]">risk {trade.apolo.risk} · conf {trade.apolo.confidence}%</p>
              <p className="mt-1 font-mono text-[9px] text-[#9C9080] leading-tight">{trade.apolo.reason}</p>
            </div>
            <div className="rounded border border-amber-500/15 bg-amber-950/[0.04] p-2">
              <p className="font-mono text-[8px] uppercase tracking-widest text-amber-300 mb-1">Hermes</p>
              <p className={`font-mono text-sm font-semibold ${ACTION_STYLE[trade.hermes.action]}`}>{trade.hermes.action.replace('_', ' ')}</p>
              <p className="font-mono text-[9px] text-[#9C9080]">{trade.hermes.sizeUsdc} USDC · {trade.hermes.mode}</p>
            </div>
          </div>
          {/* Market snapshot */}
          <div className="flex flex-wrap gap-3 font-mono text-[10px] text-[#9C9080]">
            <span>UP {trade.snapshot.upPrice.toFixed(3)} · DOWN {trade.snapshot.downPrice.toFixed(3)}</span>
            <span>spread {(trade.snapshot.spread * 100).toFixed(1)}pts</span>
            {trade.snapshot.volume != null && <span>vol ${fmt(trade.snapshot.volume, 0)}</span>}
            <span>mode: {trade.reasoningMode}</span>
            <span>hash: {trade.snapshotHash.slice(0, 10)}…</span>
          </div>
          {/* Resolution */}
          {trade.resolution && (
            <div className="rounded border border-white/5 bg-white/[0.02] p-2 font-mono text-[10px] text-[#EAE4D8]/70">
              <span className="text-[#C5A67C]">resolved</span> {trade.resolution.note} · final UP {trade.resolution.finalUpPrice.toFixed(3)} DOWN {trade.resolution.finalDownPrice.toFixed(3)} · {trade.resolution.pnlBps}bps
            </div>
          )}
          {/* x402 receipts */}
          {trade.hermes.receipts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {trade.hermes.receipts.map((r) => (
                <span key={r.receiptId} className="rounded border border-[#C5A67C]/20 bg-[#C5A67C]/5 px-2 py-0.5 font-mono text-[8px] text-[#C5A67C]">
                  {r.service} · {r.amountUsdc} USDC · {r.receiptId.slice(0, 12)}…
                </span>
              ))}
            </div>
          )}
          {trade.error && (
            <div className="font-mono text-[10px] text-rose-300">error: {trade.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PolymarketTradingPage() {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | Asset>('all');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/a2a/history?limit=100&stats=true', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setTrades(data.trades ?? []);
        setStats(data.stats ?? null);
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'fetch failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 30_000); // refresh every 30s
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return trades;
    if (filter === 'active') return trades.filter((t) => t.status === 'PENDING');
    return trades.filter((t) => t.asset === filter);
  }, [trades, filter]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-5 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto flex max-w-[1480px] flex-col gap-4">
        {/* Header */}
        <header className="overflow-hidden rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90">
          <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C] transition hover:text-[#EAE4D8]">
                ← Back to A2A Dashboard
              </Link>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">ARCLAYER · POLYMARKET TRADING</div>
              <h1 className="mt-1 text-2xl font-black uppercase tracking-[0.12em] text-[#EAE4D8] sm:text-3xl">
                Trade History & PnL
              </h1>
              <p className="mt-1 text-sm text-[#EAE4D8]/60">
                15-minute autonomous pipeline · Pythia → Apolo → Hermes · DRY_RUN
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-300">live</span>
            </div>
          </div>

          {/* Stats bar */}
          {stats && (
            <div className="flex flex-wrap gap-px bg-[#C5A67C]/10">
              <StatCard label="Total Runs" value={`${stats.total}`} sub={`${stats.skipped} skipped`} tone="cyan" />
              <StatCard label="Hit Rate" value={`${(stats.hitRate * 100).toFixed(1)}%`} sub={`${stats.wins}W / ${stats.losses}L`} tone={stats.hitRate >= 0.5 ? 'green' : 'red'} />
              <StatCard label="Cumulative PnL" value={`${stats.totalPnlUsdc >= 0 ? '+' : ''}${fmt(stats.totalPnlUsdc, 4)}`} sub={`${stats.totalPnlBps}bps total`} tone={stats.totalPnlUsdc >= 0 ? 'green' : 'red'} />
              <StatCard label="Pending" value={`${stats.pending}`} sub="awaiting resolution" tone="amber" />
              <StatCard label="BTC PnL" value={`${fmt(stats.byAsset.BTC.pnlUsdc, 4)}`} sub={`${stats.byAsset.BTC.wins}W/${stats.byAsset.BTC.losses}L`} tone={stats.byAsset.BTC.pnlUsdc >= 0 ? 'green' : 'red'} />
              <StatCard label="ETH PnL" value={`${fmt(stats.byAsset.ETH.pnlUsdc, 4)}`} sub={`${stats.byAsset.ETH.wins}W/${stats.byAsset.ETH.losses}L`} tone={stats.byAsset.ETH.pnlUsdc >= 0 ? 'green' : 'red'} />
            </div>
          )}
        </header>

        {/* PnL Chart */}
        <section className="overflow-hidden rounded-sm border border-white/10 bg-[#0A0A0A]/90">
          <div className="flex h-10 items-center gap-2 border-b border-white/10 bg-black/30 px-3">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
            <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#EAE4D8]">Cumulative PnL</h2>
          </div>
          <div className="h-[140px] p-3">
            <PnlChart trades={trades} />
          </div>
        </section>

        {/* Filter bar */}
        <div className="flex items-center gap-2">
          {(['all', 'active', 'BTC', 'ETH'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition ${
                filter === f
                  ? 'border-[#C5A67C]/40 bg-[#C5A67C]/15 text-[#C5A67C]'
                  : 'border-white/10 bg-white/[0.02] text-[#EAE4D8]/50 hover:text-[#EAE4D8]/80'
              }`}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto font-mono text-[10px] text-[#EAE4D8]/40">
            {filtered.length} trades
          </span>
        </div>

        {/* Trade list */}
        <section className="space-y-2">
          {loading && (
            <div className="rounded-sm border border-dashed border-white/10 p-8 text-center font-mono text-[11px] text-[#EAE4D8]/40 uppercase tracking-widest">
              loading trade history…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="rounded-sm border border-dashed border-white/10 p-8 text-center">
              <p className="font-mono text-[11px] text-[#EAE4D8]/40 uppercase tracking-widest">
                no trades recorded yet
              </p>
              <p className="mt-2 text-xs text-[#EAE4D8]/30">
                Start the runner: <code className="rounded bg-white/5 px-1.5 py-0.5 text-[#C5A67C]">pnpm a2a:runner</code>
              </p>
            </div>
          )}
          {filtered.map((trade) => (
            <TradeRow key={trade.id} trade={trade} />
          ))}
        </section>

        {error && (
          <div className="rounded-sm border border-rose-400/25 bg-rose-400/5 p-3 font-mono text-[10px] text-rose-200">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
