'use client';

import { useEffect, useState } from 'react';

type Direction = 'UP' | 'DOWN' | 'NEUTRAL';
type HermesAction = 'BUY_UP' | 'BUY_DOWN' | 'SKIP';

interface SignalRow {
  asset: 'BTC' | 'ETH';
  slug: string;
  window: string;
  market: { upPrice: number; downPrice: number; spread: number; volume: number | null };
  ignia: { rawSignal: Direction; confidence: number; features: string[] };
  apolo: { decision: Direction; status: 'APPROVED' | 'REJECTED'; confidence: number; risk: string; reason: string };
  hermes: { action: HermesAction; sizeUsdc: string; mode: string };
}

const DIR_COLORS: Record<Direction, string> = {
  UP: 'text-emerald-400',
  DOWN: 'text-rose-400',
  NEUTRAL: 'text-zinc-300',
};

const ACTION_COLORS: Record<HermesAction, string> = {
  BUY_UP: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  BUY_DOWN: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  SKIP: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
};

const RISK_COLORS: Record<string, string> = {
  LOW: 'text-emerald-300',
  MEDIUM: 'text-amber-300',
  HIGH: 'text-rose-300',
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  const color = pct >= 70 ? '#10b981' : pct >= 58 ? '#f59e0b' : '#ef4444';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-[10px]" style={{ color }}>{pct}%</span>
    </div>
  );
}

function SignalCard({ row }: { row: SignalRow }) {
  const assetColor = row.asset === 'BTC' ? '#F7931A' : '#627EEA';

  return (
    <div className="rounded border border-white/5 bg-white/[0.02] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold" style={{ color: assetColor }}>{row.asset}</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#bdb1a0]">{row.window}</span>
        </div>
        <span className={`rounded border px-2 py-0.5 font-mono text-[9px] font-bold uppercase ${ACTION_COLORS[row.hermes.action]}`}>
          {row.hermes.action.replace('_', ' ')}
        </span>
      </div>

      {/* Three-agent pipeline */}
      <div className="grid grid-cols-3 gap-2">
        {/* Ignia */}
        <div className="rounded border border-cyan-500/15 bg-cyan-950/[0.06] p-2.5">
          <p className="font-mono text-[9px] uppercase tracking-widest text-cyan-300 mb-1.5">Ignia · raw signal</p>
          <p className={`font-mono text-lg font-semibold ${DIR_COLORS[row.ignia.rawSignal]}`}>
            {row.ignia.rawSignal}
          </p>
          <ConfidenceBar value={row.ignia.confidence} />
          <div className="mt-1.5 space-y-0.5">
            {row.ignia.features.slice(0, 3).map((f, i) => (
              <p key={i} className="font-mono text-[9px] text-[#9C9080] truncate">• {f}</p>
            ))}
          </div>
        </div>

        {/* Apolo */}
        <div className="rounded border border-violet-500/15 bg-violet-950/[0.06] p-2.5">
          <p className="font-mono text-[9px] uppercase tracking-widest text-violet-300 mb-1.5">Apolo · decision</p>
          <p className={`font-mono text-lg font-semibold ${DIR_COLORS[row.apolo.decision]}`}>
            {row.apolo.decision}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[8px] font-bold ${row.apolo.status === 'APPROVED' ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : 'border-rose-500/30 text-rose-300 bg-rose-500/10'}`}>
              {row.apolo.status}
            </span>
            <span className={`font-mono text-[8px] ${RISK_COLORS[row.apolo.risk] ?? 'text-[#9C9080]'}`}>
              risk: {row.apolo.risk}
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[9px] text-[#9C9080] leading-[1.4]">{row.apolo.reason}</p>
        </div>

        {/* Hermes */}
        <div className="rounded border border-amber-500/15 bg-amber-950/[0.06] p-2.5">
          <p className="font-mono text-[9px] uppercase tracking-widest text-amber-300 mb-1.5">Hermes · action</p>
          <p className={`font-mono text-lg font-semibold ${row.hermes.action === 'SKIP' ? 'text-zinc-300' : row.hermes.action === 'BUY_UP' ? 'text-emerald-400' : 'text-rose-400'}`}>
            {row.hermes.action === 'SKIP' ? 'SKIP' : row.hermes.action === 'BUY_UP' ? '⬆ BUY' : '⬇ BUY'}
          </p>
          <div className="mt-1.5 space-y-1">
            <div className="flex justify-between font-mono text-[10px]">
              <span className="text-[#bdb1a0]">size</span>
              <span className="text-[#EAE4D8]">{row.hermes.sizeUsdc} USDC</span>
            </div>
            <div className="flex justify-between font-mono text-[9px]">
              <span className="text-[#bdb1a0]">mode</span>
              <span className="text-cyan-300">{row.hermes.mode}</span>
            </div>
            <div className="flex justify-between font-mono text-[9px]">
              <span className="text-[#bdb1a0]">x402 paid</span>
              <span className="text-emerald-300">0.000001 USDC</span>
            </div>
          </div>
        </div>
      </div>

      {/* Market context */}
      <div className="flex items-center gap-3 font-mono text-[10px] text-[#9C9080]">
        <span>UP {row.market.upPrice.toFixed(3)} · DOWN {row.market.downPrice.toFixed(3)}</span>
        <span>spread {(row.market.spread * 100).toFixed(1)}pts</span>
        {row.market.volume && <span>vol ${row.market.volume.toFixed(2)}</span>}
        <a
          href={`https://polymarket.com/event/${row.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-[#C5A67C] hover:text-[#e8d4b0]"
        >
          polymarket ↗
        </a>
      </div>
    </div>
  );
}

export default function LiveSignalPanel() {
  const [rows, setRows] = useState<SignalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastTs, setLastTs] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/a2a/live-signal', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setRows(data.rows ?? []);
        setLastTs(data.timestamp ?? Date.now());
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'fetch failed');
      }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="rounded border border-white/5 bg-white/[0.015] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-violet-400 animate-pulse" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-violet-300">
            live signal pipeline · ignia → apolo → hermes
          </p>
        </div>
        {lastTs > 0 && (
          <span className="font-mono text-[10px] text-[#9C9080]">
            {new Date(lastTs).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded border border-rose-500/20 bg-rose-950/[0.08] px-3 py-2 font-mono text-[10px] text-rose-300/80">
          signal error: {error}
        </div>
      )}

      {rows.length === 0 && !error ? (
        <div className="rounded border border-dashed border-white/10 p-6 text-center">
          <p className="font-mono text-[11px] text-[#bdb1a0]">loading signal pipeline…</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <SignalCard key={`${row.asset}-${row.slug}`} row={row} />
          ))}
        </div>
      )}

      <p className="mt-3 font-mono text-[10px] text-[#9C9080]">
        Signals derived from live Polymarket 5m UP/DOWN markets. Ignia reads raw orderbook data →
        Apolo applies risk policy and approves/rejects → Hermes executes (dry-run). When PM2 agents
        are running, this panel reflects real-time agent decisions with x402 payment receipts.
      </p>
    </div>
  );
}
