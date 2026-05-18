'use client';

import { useEffect, useMemo, useState } from 'react';

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

type SignalEvent = {
  id: string;
  verdict: Verdict;
  market: string;
  confidence: number;
  ts: string;
  thesis: string;
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
  YES: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
  PASS: 'border-amber-400/35 bg-amber-400/10 text-amber-200',
  EDGE: 'border-cyan-400/35 bg-cyan-400/10 text-cyan-200',
  'NO EDGE': 'border-rose-400/35 bg-rose-400/10 text-rose-200',
  REVIEW: 'border-violet-400/35 bg-violet-400/10 text-violet-200',
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
    thesis: row.apolo.reason,
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
      className={`min-w-0 overflow-hidden rounded-xl border border-cyan-400/10 bg-[#07101d]/92 shadow-[0_0_40px_rgba(0,212,255,0.05)] ${className}`}
    >
      <div className="flex h-10 items-center gap-2 border-b border-cyan-400/10 bg-[#0b1424] px-3">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-slate-300">{title}</h2>
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </div>
      {children}
    </section>
  );
}

function Chip({ children, tone = 'cyan' }: { children: React.ReactNode; tone?: 'cyan' | 'green' | 'red' | 'amber' | 'violet' | 'slate' }) {
  const tones = {
    cyan: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200',
    green: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    red: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
    amber: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    violet: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
    slate: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
  };
  return (
    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tones[tone]}`}>
      {children}
    </span>
  );
}

function MetricCard({ label, value, sub, tone = 'cyan' }: { label: string; value: string; sub: string; tone?: 'cyan' | 'green' | 'red' | 'amber' | 'violet' }) {
  const valueTone = {
    cyan: 'text-cyan-200',
    green: 'text-emerald-200',
    red: 'text-rose-200',
    amber: 'text-amber-200',
    violet: 'text-violet-200',
  }[tone];
  return (
    <div className="min-w-[150px] flex-1 border-r border-cyan-400/10 bg-[#091321] px-4 py-3 last:border-r-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className={`mt-1 font-mono text-lg font-bold ${valueTone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-400">{sub}</div>
    </div>
  );
}

// ─── Live edge readout (UP/DOWN, no candles) ─────────────────────────────────

function LiveEdgeBoard({ btc, eth, latest }: { btc?: LiveMarket; eth?: LiveMarket; latest: SignalRow | null }) {
  const cards = [
    { label: 'BTC · UP (5m)', val: btc ? btc.upPrice.toFixed(3) : '—', tone: 'green' as const, sub: btc ? `vol ${fmt(btc.volume ?? 0, 0)}` : 'awaiting market' },
    { label: 'BTC · DOWN (5m)', val: btc ? btc.downPrice.toFixed(3) : '—', tone: 'red' as const, sub: btc ? `spread ${(Math.abs(btc.upPrice - btc.downPrice) * 1000).toFixed(0)} bps` : '—' },
    { label: 'ETH · UP (5m)', val: eth ? eth.upPrice.toFixed(3) : '—', tone: 'violet' as const, sub: eth ? `vol ${fmt(eth.volume ?? 0, 0)}` : 'awaiting market' },
    { label: 'ETH · DOWN (5m)', val: eth ? eth.downPrice.toFixed(3) : '—', tone: 'red' as const, sub: eth ? `spread ${(Math.abs(eth.upPrice - eth.downPrice) * 1000).toFixed(0)} bps` : '—' },
    { label: 'Apolo Verdict', val: latest ? latest.apolo.decision : '—', tone: 'cyan' as const, sub: latest ? `${latest.apolo.confidence}% conf · ${latest.apolo.risk} risk` : 'no signal yet' },
    { label: 'Hermes Action', val: latest ? latest.hermes.action : 'SKIP', tone: 'amber' as const, sub: latest ? `${latest.hermes.sizeUsdc} USDC · ${latest.hermes.mode}` : 'idle' },
  ];
  const valueTone: Record<'green' | 'red' | 'cyan' | 'amber' | 'violet', string> = {
    green: 'text-emerald-200',
    red: 'text-rose-200',
    cyan: 'text-cyan-200',
    amber: 'text-amber-200',
    violet: 'text-violet-200',
  };
  return (
    <div className="grid h-full grid-cols-2 gap-px bg-cyan-400/10 lg:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="min-w-0 bg-[#07101d] p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">{c.label}</div>
          <div className={`mt-1 font-mono text-2xl font-bold ${valueTone[c.tone]}`}>{c.val}</div>
          <div className="mt-1 truncate text-xs text-slate-400">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Orderbook (kept) ────────────────────────────────────────────────────────

function PolymarketOrderbook({ book, asset }: { book: Orderbook | null; asset: 'BTC' | 'ETH' }) {
  if (!book || !book.ok || (!book.bids?.length && !book.asks?.length)) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[10px] uppercase tracking-widest text-slate-500">
        {book?.error || `Loading ${asset} orderbook…`}
      </div>
    );
  }

  const asks = (book.asks || []).map((l) => ({ price: parseFloat(l.price), size: parseFloat(l.size) })).sort((a, b) => b.price - a.price).slice(0, 7);
  const bids = (book.bids || []).map((l) => ({ price: parseFloat(l.price), size: parseFloat(l.size) })).sort((a, b) => b.price - a.price).slice(0, 7);

  let askTotal = 0;
  const askLevels = asks.map((l) => ({ ...l, total: (askTotal += l.size) }));
  let bidTotal = 0;
  const bidLevels = bids.map((l) => ({ ...l, total: (bidTotal += l.size) }));
  const maxTotal = Math.max(askTotal, bidTotal, 1);

  const row = (level: { price: number; size: number; total: number }, side: 'ask' | 'bid') => (
    <div key={`${side}-${level.price}`} className="relative grid grid-cols-3 px-3 py-1.5 font-mono text-[11px]">
      <span className={`relative z-10 ${side === 'ask' ? 'text-rose-300' : 'text-emerald-300'}`}>{level.price.toFixed(3)}</span>
      <span className="relative z-10 text-center text-slate-400">{fmt(level.size, 0)}</span>
      <span className="relative z-10 text-right text-slate-400">{fmt(level.total, 0)}</span>
      <span
        className={`absolute inset-y-0 right-0 ${side === 'ask' ? 'bg-rose-400/10' : 'bg-emerald-400/10'}`}
        style={{ width: `${Math.min(96, (level.total / maxTotal) * 100)}%` }}
      />
    </div>
  );

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <div className="grid grid-cols-3 border-b border-cyan-400/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate-400">
        <span>YES Price</span>
        <span className="text-center">Size</span>
        <span className="text-right">Total</span>
      </div>
      <div>{askLevels.map((x) => row(x, 'ask'))}</div>
      <div className="border-y border-cyan-400/10 bg-cyan-400/5 px-3 py-2 text-center font-mono text-sm font-bold text-cyan-200">
        MID {book.mid != null ? book.mid.toFixed(3) : '—'} · {asset} 5m · live polymarket
      </div>
      <div>{bidLevels.map((x) => row(x, 'bid'))}</div>
    </div>
  );
}

// ─── Apolo Pay → Receipt → Reputation flow (LIVE from latest signal + status) ─

type ApoloFlowProps = {
  latest: SignalRow | null;
  apoloStat?: AgentStat;
  txCount: number;
};

function ApoloPaymentFlow({ latest, apoloStat, txCount }: ApoloFlowProps) {
  const paid = !!latest && latest.apolo.status !== 'REJECTED';
  const size = latest?.hermes.sizeUsdc ?? '0';
  const decision = latest?.apolo.decision ?? '—';
  const asset = latest?.asset ?? '—';
  const reputation = apoloStat?.reputationScore ?? null;
  const calls = apoloStat?.callsServed ?? null;
  const revenueUsdc = apoloStat?.totalRevenue ? Number(apoloStat.totalRevenue) / 1e6 : null;

  const steps: Array<{ k: string; title: string; sub: string; state: 'live' | 'wait' | 'idle'; tone: 'green' | 'cyan' | 'violet' | 'amber' }> = [
    {
      k: '01',
      title: 'Pay Agent',
      sub: latest ? `Client → Apolo · ${size} USDC via x402` : 'awaiting next signal',
      state: latest ? 'live' : 'idle',
      tone: 'green',
    },
    {
      k: '02',
      title: 'Payment Completed',
      sub: paid ? `${size} USDC authorized on Arc` : 'rejected by Apolo risk gate',
      state: paid ? 'live' : 'wait',
      tone: 'cyan',
    },
    {
      k: '03',
      title: 'Work Receipt',
      sub: paid ? `receipt: ${asset}-${decision} · conf ${latest!.apolo.confidence}%` : 'created on approved signals',
      state: paid ? 'live' : 'wait',
      tone: 'violet',
    },
    {
      k: '04',
      title: 'Apolo Reputation',
      sub: reputation != null
        ? `score ${reputation} · ${calls ?? 0} calls served${revenueUsdc != null ? ` · $${fmt(revenueUsdc, 2)} earned` : ''}`
        : `${txCount} approvals this session · live counter`,
      state: 'live',
      tone: 'amber',
    },
  ];

  const toneText: Record<typeof steps[number]['tone'], string> = {
    green: 'text-emerald-200',
    cyan: 'text-cyan-200',
    violet: 'text-violet-200',
    amber: 'text-amber-200',
  };

  return (
    <div className="grid h-full min-h-[260px] grid-cols-1 gap-3 p-4 md:grid-cols-4">
      {steps.map((s, i) => (
        <div
          key={s.k}
          className={`relative rounded-xl border p-4 ${
            s.state === 'live' ? 'border-cyan-300/30 bg-cyan-400/5' : s.state === 'wait' ? 'border-amber-300/15 bg-amber-400/5' : 'border-slate-400/15 bg-black/15'
          }`}
        >
          {i < steps.length - 1 && <span className="absolute -right-3 top-1/2 hidden h-px w-6 bg-cyan-300/25 md:block" />}
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">{s.k}</span>
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                s.state === 'live'
                  ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200'
                  : s.state === 'wait'
                    ? 'border-amber-300/30 bg-amber-400/10 text-amber-200'
                    : 'border-slate-400/30 bg-slate-400/10 text-slate-300'
              }`}
            >
              {s.state === 'live' ? 'LIVE' : s.state === 'wait' ? 'WAIT' : 'IDLE'}
            </span>
          </div>
          <div className={`mt-2 font-mono text-sm font-bold uppercase tracking-[0.16em] ${toneText[s.tone]}`}>{s.title}</div>
          <div className="mt-2 text-xs leading-5 text-slate-400">{s.sub}</div>
          <div className="mt-4 h-1 overflow-hidden rounded bg-slate-800">
            <div
              className={`h-full ${s.state === 'live' ? 'bg-cyan-300' : s.state === 'wait' ? 'bg-amber-300/50' : 'bg-slate-700'}`}
              style={{ width: `${s.state === 'live' ? 100 : s.state === 'wait' ? 50 : 18}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Backend autonomous route: Pythia → Apolo → Hermes (24/7 loop) ───────────

function AutonomousLoopFlow({ latest, tick }: { latest: SignalRow | null; tick: number }) {
  const stages: Array<{ name: string; role: string; value: string; sub: string; active: boolean }> = [
    {
      name: 'Pythia',
      role: 'Oracle',
      value: latest?.ignia.rawSignal ?? 'NEUTRAL',
      sub: latest ? `${latest.asset} · ${latest.ignia.confidence}% conf` : 'polling Polymarket Gamma',
      active: !!latest,
    },
    {
      name: 'Apolo',
      role: 'Resolver',
      value: latest?.apolo.status ?? 'WAITING',
      sub: latest ? latest.apolo.reason : 'filters edge + risk gate',
      active: latest?.apolo.status === 'APPROVED',
    },
    {
      name: 'Hermes',
      role: 'Trader',
      value: latest?.hermes.action ?? 'SKIP',
      sub: latest ? `${latest.hermes.sizeUsdc} USDC · ${latest.hermes.mode}` : 'awaits Apolo approval',
      active: latest?.hermes.action !== 'SKIP' && latest?.hermes.action != null,
    },
  ];

  return (
    <div className="flex h-full min-h-[240px] flex-col gap-3 p-4">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
        <span>autonomous loop · 24/7 · scan #{tick}</span>
        <span className="flex items-center gap-1 text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> running
        </span>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-3">
        {stages.map((s, i) => (
          <div
            key={s.name}
            className={`relative rounded-xl border p-4 ${
              s.active ? 'border-cyan-300/35 bg-cyan-400/10 shadow-[0_0_24px_rgba(0,212,255,0.08)]' : 'border-slate-400/15 bg-black/15'
            }`}
          >
            {i < stages.length - 1 && (
              <span className="absolute -right-3 top-1/2 hidden h-px w-6 bg-cyan-300/25 md:block" />
            )}
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">{s.role}</div>
            <div className="mt-1 font-mono text-base font-bold uppercase tracking-[0.16em] text-cyan-100">{s.name}</div>
            <div className="mt-3 rounded border border-cyan-400/15 bg-cyan-400/5 px-3 py-2 text-center font-mono text-xl text-emerald-200">
              {s.value}
            </div>
            <div className="mt-2 truncate text-xs text-slate-400">{s.sub}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-cyan-400/10 bg-black/20 px-3 py-2 font-mono text-[10px] text-slate-400">
        loop: poll markets → engines vote → Apolo resolves → Hermes (DRY_RUN) emits action → repeat every 8s
      </div>
    </div>
  );
}

// ─── Signal Stream (3 cols, scrollable) ──────────────────────────────────────

function SignalStream({ signals }: { signals: SignalEvent[] }) {
  if (!signals.length) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[10px] uppercase tracking-widest text-slate-500">
        Waiting for live signals…
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-[92px_1fr_84px] border-b border-cyan-400/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate-400">
        <span>Verdict</span>
        <span>Signal → Apolo Output</span>
        <span className="text-right">Conf</span>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {signals.map((s) => (
          <div
            key={s.id}
            className="grid min-w-0 grid-cols-[92px_1fr_84px] gap-2 rounded border border-cyan-400/5 bg-white/[0.015] px-2 py-2 font-mono text-[11px]"
          >
            <span className={`truncate rounded border px-1.5 py-1 text-center text-[9px] ${verdictTone[s.verdict]}`}>{s.verdict}</span>
            <div className="min-w-0">
              <div className="truncate text-slate-200">{s.market}</div>
              <div className="truncate text-[10px] text-slate-400">{s.ts} UTC · {s.thesis}</div>
            </div>
            <span className="text-right text-emerald-200">{s.confidence}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LiveA2AAgentPageRoute() {
  const [now, setNow] = useState('');
  const [markets, setMarkets] = useState<LiveMarket[]>([]);
  const [signalRows, setSignalRows] = useState<SignalRow[]>([]);
  const [signalEvents, setSignalEvents] = useState<SignalEvent[]>([]);
  const [bookBtc, setBookBtc] = useState<Orderbook | null>(null);
  const [bookEth, setBookEth] = useState<Orderbook | null>(null);
  const [orderbookAsset, setOrderbookAsset] = useState<'BTC' | 'ETH'>('BTC');
  const [scanCount, setScanCount] = useState(0);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [a2aStatus, setA2aStatus] = useState<A2AStatusData | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const latestRow = signalRows[0] ?? null;
  const latestVerdict = verdictFromSignal(latestRow ?? undefined);

  // Clock
  useEffect(() => {
    setNow(new Date().toISOString().slice(11, 19));
    const t = setInterval(() => setNow(new Date().toISOString().slice(11, 19)), 1000);
    return () => clearInterval(t);
  }, []);

  // Markets + signals (every 8s)
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
          setScanCount((n) => n + (rows.length || 0));
        }
      } catch (err: any) {
        if (alive) setErrors((e) => [`signals: ${err?.message}`, ...e].slice(0, 3));
      }
    }
    load();
    const t = setInterval(load, 8000);
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

  // Orderbook (every 4s)
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`/api/a2a/orderbook?asset=${orderbookAsset}`, { cache: 'no-store' });
        if (!alive) return;
        if (r.ok) {
          const data = (await r.json()) as Orderbook;
          if (orderbookAsset === 'BTC') setBookBtc(data);
          else setBookEth(data);
        }
      } catch (err: any) {
        if (alive) setErrors((e) => [`book: ${err?.message}`, ...e].slice(0, 3));
      }
    }
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [orderbookAsset]);

  const btcMarket = useMemo(() => markets.find((m) => m.asset === 'BTC'), [markets]);
  const ethMarket = useMemo(() => markets.find((m) => m.asset === 'ETH'), [markets]);
  const activeBook = orderbookAsset === 'BTC' ? bookBtc : bookEth;

  const apoloStat = a2aStatus?.agents?.apolo?.stats;
  const pythiaStat = a2aStatus?.agents?.pythia?.stats;
  const hermesStat = a2aStatus?.agents?.hermes?.stats;

  const workproofReady = signalRows.filter((r) => r.apolo.status === 'APPROVED').length;

  // Traction metrics — prefer backend numbers, fallback to live session counters
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

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#030609] px-3 py-4 text-slate-200 sm:px-5 lg:px-7">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(0,212,255,0.12),transparent_34%),radial-gradient(circle_at_80%_10%,rgba(153,102,255,0.12),transparent_30%),linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[length:auto,auto,100%_4px]" />
      <div className="relative mx-auto flex max-w-[1800px] flex-col gap-3">
        <header className="overflow-hidden rounded-xl border border-cyan-400/15 bg-[#07101d]/95">
          <div className="flex flex-col gap-3 border-b border-cyan-400/10 px-4 py-3 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.4em] text-cyan-300">ARCLAYER · A2A</div>
              <h1 className="mt-1 text-2xl font-black uppercase tracking-[0.2em] text-white sm:text-3xl">LIVE A2A AGENT</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-300">
                Pythia (Oracle) → Apolo (Resolver) → Hermes (Trader). Apolo is paid in USDC via x402, returns work receipt, earns reputation. Loop runs autonomously 24/7 against live Polymarket BTC/ETH 5m markets.
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Chip tone="green">PAY AGENT</Chip>
              <Chip tone="cyan">WORK RECEIPT</Chip>
              <Chip tone="amber">APOLO REP</Chip>
              <div className="font-mono text-xs text-slate-400">{now} UTC</div>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap">
            <MetricCard label="Total Requests" value={`${totalRequests}`} sub="agent calls + scans" tone="cyan" />
            <MetricCard label="Total USDC Volume" value={`$${fmt(totalUsdcVolume, 2)}`} sub="x402 + escrow settled" tone="green" />
            <MetricCard label="Total Agents" value={`${totalAgents}`} sub="registered network" tone="violet" />
            <MetricCard label="Completed Jobs" value={`${completedJobs}`} sub="settled work receipts" tone="amber" />
          </div>
        </header>

        <section className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[1.35fr_0.65fr]">
          <TerminalPanel title="Apolo · Pay → Receipt → Reputation" right={<Chip tone="green">LIVE x402</Chip>} className="min-h-[320px]">
            <ApoloPaymentFlow latest={latestRow} apoloStat={apoloStat} txCount={workproofReady} />
          </TerminalPanel>

          <TerminalPanel title="Autonomous Backend Route" right={<Chip tone="cyan">PYTHIA → APOLO → HERMES</Chip>} className="min-h-[320px]">
            <AutonomousLoopFlow latest={latestRow} tick={scanCount} />
          </TerminalPanel>
        </section>

        <section className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[1.4fr_1fr]">
          <TerminalPanel
            title="Live Edge · UP / DOWN"
            right={
              <Chip tone={latestVerdict === 'YES' ? 'green' : latestVerdict === 'NO EDGE' ? 'red' : latestVerdict === 'EDGE' ? 'cyan' : 'amber'}>
                {latestVerdict}
              </Chip>
            }
            className="h-[340px]"
          >
            <LiveEdgeBoard btc={btcMarket} eth={ethMarket} latest={latestRow} />
          </TerminalPanel>

          <TerminalPanel
            title="Polymarket Orderbook"
            right={
              <div className="flex items-center gap-1">
                {(['BTC', 'ETH'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setOrderbookAsset(a)}
                    className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition ${
                      orderbookAsset === a
                        ? 'border-cyan-400/40 bg-cyan-400/15 text-cyan-100'
                        : 'border-slate-400/20 bg-slate-400/5 text-slate-300 hover:bg-slate-400/10'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            }
            className="h-[340px]"
          >
            <PolymarketOrderbook book={activeBook} asset={orderbookAsset} />
          </TerminalPanel>
        </section>

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
          <div className="rounded border border-rose-400/30 bg-rose-400/5 px-3 py-2 font-mono text-[10px] text-rose-200">
            recent fetch warnings: {errors.join(' · ')}
          </div>
        )}
      </div>
    </main>
  );
}
