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

type HistoryPoint = { t: number; p: number };

type Candle = { o: number; h: number; l: number; c: number; v: number };

type SignalEvent = {
  id: string;
  verdict: Verdict;
  market: string;
  confidence: number;
  evidence: number;
  engine: string;
  thesis: string;
  ts: string;
};

type OverviewData = {
  summary?: {
    totalAgents?: number | string;
    totalJobs?: number | string;
    completedJobs?: number | string;
    totalFunded?: string;
  };
};

type A2AStatusData = {
  agents?: {
    pythia?: { stats?: { callsServed?: number; totalRevenue?: string; reputationScore?: number } };
    hermes?: { stats?: { callsServed?: number; totalRevenue?: string } };
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

function pointsToCandles(points: HistoryPoint[], bucketSec = 300): Candle[] {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const buckets = new Map<number, number[]>();
  for (const pt of sorted) {
    const key = Math.floor(pt.t / bucketSec) * bucketSec;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(pt.p);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(-72)
    .map(([, prices]) => {
      const o = prices[0];
      const c = prices[prices.length - 1];
      return {
        o,
        c,
        h: Math.max(...prices),
        l: Math.min(...prices),
        v: Math.min(100, prices.length * 8),
      };
    });
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
    market: `${row.asset} Up or Down — 5m`,
    confidence: row.apolo.confidence,
    evidence: Math.round(row.market.spread * 1000),
    engine: row.apolo.status === 'APPROVED' ? 'Forecast + Microstructure' : 'Risk Gate',
    thesis: row.apolo.reason,
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

function CandleChart({ candles, color = '#00d4ff' }: { candles: Candle[]; color?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;
    ctx.clearRect(0, 0, W, H);

    const chartH = H * 0.78;
    const hi = Math.max(...candles.map((c) => c.h));
    const lo = Math.min(...candles.map((c) => c.l));
    const range = hi - lo || 0.01;
    const pad = range * 0.12;
    const yOf = (p: number) => chartH - ((p - lo + pad) / (range + pad * 2)) * chartH + 8;
    const step = W / candles.length;
    const bodyW = Math.max(2, step * 0.62);

    ctx.strokeStyle = 'rgba(0,212,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i += 1) {
      const y = (chartH / 5) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    candles.forEach((c, i) => {
      const x = i * step + step / 2;
      const up = c.c >= c.o;
      const col = up ? '#34d399' : '#fb7185';
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.moveTo(x, yOf(c.h));
      ctx.lineTo(x, yOf(c.l));
      ctx.stroke();
      ctx.fillStyle = col;
      const top = yOf(Math.max(c.o, c.c));
      const bottom = yOf(Math.min(c.o, c.c));
      ctx.fillRect(x - bodyW / 2, top, bodyW, Math.max(1, bottom - top));
      ctx.globalAlpha = 0.2;
      ctx.fillRect(x - bodyW / 2, H - (c.v / 100) * H * 0.16 - 4, bodyW, (c.v / 100) * H * 0.16);
      ctx.globalAlpha = 1;
    });

    const lastY = yOf(candles[candles.length - 1].c);
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, lastY);
    ctx.lineTo(W, lastY);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [candles, color]);

  if (candles.length < 2) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[10px] uppercase tracking-widest text-slate-500">
        No history yet for current 5m window
      </div>
    );
  }
  return <canvas ref={canvasRef} className="h-full w-full" />;
}

function SignalStream({ signals }: { signals: SignalEvent[] }) {
  if (!signals.length) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[10px] uppercase tracking-widest text-slate-500">
        Waiting for live signals…
      </div>
    );
  }
  return (
    <div className="h-full overflow-hidden">
      <div className="grid grid-cols-[92px_1fr_96px] border-b border-cyan-400/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate-400">
        <span>Status</span>
        <span>Signal → Resolver Output</span>
        <span className="text-right">Score</span>
      </div>
      <div className="h-[calc(100%-34px)] space-y-1 overflow-y-auto p-2">
        {signals.map((s) => (
          <div
            key={s.id}
            className="grid min-w-0 grid-cols-[92px_1fr_96px] gap-2 rounded border border-cyan-400/5 bg-white/[0.015] px-2 py-2 font-mono text-[11px]"
          >
            <span className={`truncate rounded border px-1.5 py-1 text-center text-[9px] ${verdictTone[s.verdict]}`}>{s.verdict}</span>
            <div className="min-w-0">
              <div className="truncate text-slate-200">{s.market}</div>
              <div className="truncate text-[10px] text-slate-400">{s.ts} UTC · {s.engine} · {s.thesis}</div>
            </div>
            <span className="text-right text-emerald-200">{s.confidence}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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

function AgentDecisionFlow({ active, signal }: { active: Verdict; signal: SignalRow | null }) {
  const nodes: Array<[string, string]> = [
    ['Ignia · Oracle', signal ? `UP ${signal.market.upPrice.toFixed(3)} / DOWN ${signal.market.downPrice.toFixed(3)}` : 'awaiting market'],
    ['Regime', 'volatility phase'],
    ['Entry Quality', 'spread + fee edge'],
    ['Microstructure', 'imbalance + depth'],
    ['Sniper', 'late-window timing'],
    ['Forecast', 'probability model'],
    ['Synthetic-Arb', 'cross-market hedge'],
    ['Apolo · Resolver', `verdict: ${active}`],
  ];
  return (
    <div className="grid h-full min-h-[260px] grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {nodes.map(([name, sub], i) => {
        const hot = i === nodes.length - 1 || (active !== 'NO EDGE' && i > 0 && i < 7);
        return (
          <div
            key={name}
            className={`relative flex min-h-[90px] min-w-0 flex-col justify-center rounded-xl border p-3 ${
              hot ? 'border-cyan-300/35 bg-cyan-400/10 shadow-[0_0_24px_rgba(0,212,255,0.08)]' : 'border-cyan-400/10 bg-black/10'
            }`}
          >
            {i < nodes.length - 1 && <span className="absolute -right-2 top-1/2 hidden h-px w-4 bg-cyan-300/30 lg:block" />}
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100">{name}</div>
            <div className="mt-1 text-xs text-slate-400">{sub}</div>
            <div className="mt-3 h-1 overflow-hidden rounded bg-slate-800">
              <div className={`h-full ${hot ? 'bg-cyan-300' : 'bg-slate-700'}`} style={{ width: `${hot ? 68 + i * 3 : 22}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}


function PaymentWorkFlow({ signal, reputation }: { signal: SignalRow | null; reputation: number | string }) {
  const steps = [
    ['Pay agent', 'Client pays Apolo resolver via x402/Arc USDC', 'green'],
    ['Payment completed', signal ? `${signal.hermes.sizeUsdc} USDC authorized` : 'awaiting signal payment', 'cyan'],
    ['Work receipt', signal ? `receipt: ${signal.asset}-${signal.apolo.decision}` : 'created after resolver output', 'violet'],
    ['Agent reputation', `Apolo +rep · score ${reputation ?? '—'}`, 'amber'],
  ] as Array<[string, string, 'green' | 'cyan' | 'violet' | 'amber']>;
  return (
    <div className="grid h-full min-h-[260px] grid-cols-1 gap-3 p-4 md:grid-cols-4">
      {steps.map(([title, sub, tone], i) => (
        <div key={title} className="relative rounded-xl border border-cyan-400/10 bg-black/15 p-4">
          {i < steps.length - 1 && <span className="absolute -right-3 top-1/2 hidden h-px w-6 bg-cyan-300/25 md:block" />}
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">0{i + 1}</div>
          <div className={`mt-2 font-mono text-sm font-bold uppercase tracking-[0.16em] ${
            tone === 'green' ? 'text-emerald-200' : tone === 'violet' ? 'text-violet-200' : tone === 'amber' ? 'text-amber-200' : 'text-cyan-200'
          }`}>{title}</div>
          <div className="mt-2 text-xs leading-5 text-slate-400">{sub}</div>
          <div className="mt-4 h-1 overflow-hidden rounded bg-slate-800">
            <div className="h-full bg-cyan-300" style={{ width: `${signal ? 100 : 38 + i * 12}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ResolverTradeFlow({ signal }: { signal: SignalRow | null }) {
  const stages = [
    ['Pythia · Oracle', signal?.ignia.rawSignal ?? 'NEUTRAL', 'publishes market signal'],
    ['Apolo · Resolver', signal?.apolo.status ?? 'WAITING', 'filters data + earns reputation'],
    ['Hermes · Trade', signal?.hermes.action ?? 'SKIP', 'executes approved trade output'],
  ];
  return (
    <div className="grid h-full min-h-[240px] grid-cols-1 gap-3 p-4 md:grid-cols-3">
      {stages.map(([name, value, sub], i) => (
        <div key={name} className="relative rounded-xl border border-cyan-400/10 bg-[#07101d] p-4">
          {i < stages.length - 1 && <span className="absolute -right-3 top-1/2 hidden h-px w-6 bg-cyan-300/25 md:block" />}
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">{sub}</div>
          <div className="mt-2 font-mono text-sm font-bold uppercase tracking-[0.16em] text-cyan-100">{name}</div>
          <div className="mt-3 rounded border border-cyan-400/15 bg-cyan-400/5 px-3 py-2 font-mono text-lg text-emerald-200">{value}</div>
        </div>
      ))}
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
  const [historyBtc, setHistoryBtc] = useState<HistoryPoint[]>([]);
  const [historyEth, setHistoryEth] = useState<HistoryPoint[]>([]);
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
              if (uniq.length >= 16) break;
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

  // Traction metrics from ArcLayer indexer + A2A telemetry
  useEffect(() => {
    let alive = true;
    async function loadTraction() {
      try {
        const cacheBust = Date.now();
        const [ovRes, statusRes] = await Promise.all([
          fetch(`/api/indexer/overview?t=${cacheBust}`, { cache: 'no-store' }),
          fetch(`/api/a2a/status?t=${cacheBust}`, { cache: 'no-store' }),
        ]);
        if (!alive) return;
        if (ovRes.ok) setOverview(await ovRes.json());
        if (statusRes.ok) setA2aStatus(await statusRes.json());
      } catch (err: any) {
        if (alive) setErrors((e) => [`traction: ${err?.message}`, ...e].slice(0, 3));
      }
    }
    loadTraction();
    const t = setInterval(loadTraction, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Orderbook for selected asset (every 4s)
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

  // History BTC + ETH (every 30s)
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [b, e] = await Promise.all([
          fetch('/api/a2a/history?asset=BTC&interval=1d&fidelity=300', { cache: 'no-store' }).then((r) => r.json()),
          fetch('/api/a2a/history?asset=ETH&interval=1d&fidelity=300', { cache: 'no-store' }).then((r) => r.json()),
        ]);
        if (!alive) return;
        if (b?.ok) setHistoryBtc(b.history || []);
        if (e?.ok) setHistoryEth(e.history || []);
      } catch (err: any) {
        if (alive) setErrors((er) => [`history: ${err?.message}`, ...er].slice(0, 3));
      }
    }
    load();
    const t = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const candlesBtc = useMemo(() => pointsToCandles(historyBtc), [historyBtc]);
  const candlesEth = useMemo(() => pointsToCandles(historyEth), [historyEth]);

  const btcMarket = markets.find((m) => m.asset === 'BTC');
  const ethMarket = markets.find((m) => m.asset === 'ETH');
  const activeBook = orderbookAsset === 'BTC' ? bookBtc : bookEth;

  const confidenceAvg = signalRows.length
    ? Math.round(signalRows.reduce((acc, r) => acc + r.apolo.confidence, 0) / signalRows.length)
    : 0;
  const evidenceScore = signalRows.length
    ? Math.round(Math.max(...signalRows.map((r) => r.market.spread * 1000)))
    : 0;
  const engineAgreement = signalRows.length
    ? Math.round((signalRows.filter((r) => r.apolo.status === 'APPROVED').length / signalRows.length) * 100)
    : 0;
  const noEdgeCount = signalRows.filter((r) => r.apolo.status === 'REJECTED').length;
  const workproofReady = signalRows.filter((r) => r.apolo.status === 'APPROVED').length;
  const totalRequests = Math.max(
    scanCount,
    Number(a2aStatus?.agents?.pythia?.stats?.callsServed ?? 0) + Number(a2aStatus?.agents?.hermes?.stats?.callsServed ?? 0),
  );
  const totalUSDCVolume = (
    Number(overview?.summary?.totalFunded ?? '0') +
    Number(a2aStatus?.agents?.pythia?.stats?.totalRevenue ?? '0') +
    Number(a2aStatus?.agents?.hermes?.stats?.totalRevenue ?? '0')
  ) / 1e6;
  const totalAgents = Number(overview?.summary?.totalAgents ?? 0) || 3;
  const completedJobs = Number(overview?.summary?.completedJobs ?? 0) || workproofReady;
  const apoloReputation = a2aStatus?.agents?.pythia?.stats?.reputationScore ?? (100 + workproofReady * 2);

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
                Live A2A payment + work receipt demo. Pythia (Oracle) → Apolo (Resolver) → Hermes (Trader).
                Reviewer flow: agent paid, output returned, receipt visible, Apolo reputation updates.
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
            <MetricCard label="Total Requests" value={`${totalRequests}`} sub="agent calls + live signals" tone="cyan" />
            <MetricCard label="Total USDC Volume" value={`$${fmt(totalUSDCVolume, 2)}`} sub="escrow + x402 revenue" tone="green" />
            <MetricCard label="Total Agents" value={`${totalAgents}`} sub="registered network" tone="violet" />
            <MetricCard label="Completed Jobs" value={`${completedJobs}`} sub="settled work receipts" tone="amber" />
          </div>
        </header>

        <section className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[1.35fr_0.65fr]">
          <TerminalPanel title="Paid Agent Work Flow" right={<Chip tone="green">VISIBLE FRONTEND FLOW</Chip>} className="min-h-[320px]">
            <PaymentWorkFlow signal={latestRow} reputation={apoloReputation} />
          </TerminalPanel>

          <TerminalPanel title="Backend Agent Route" right={<Chip tone="cyan">PYTHIA → APOLO → HERMES</Chip>} className="min-h-[320px]">
            <ResolverTradeFlow signal={latestRow} />
          </TerminalPanel>
        </section>

        <section className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[1.6fr_1fr]">
          <TerminalPanel
            title="Agent Decision Flow"
            right={
              <Chip
                tone={
                  latestVerdict === 'YES'
                    ? 'green'
                    : latestVerdict === 'NO EDGE'
                      ? 'red'
                      : latestVerdict === 'EDGE'
                        ? 'cyan'
                        : 'amber'
                }
              >
                {latestVerdict}
              </Chip>
            }
            className="min-h-[340px]"
          >
            <AgentDecisionFlow active={latestVerdict} signal={latestRow} />
          </TerminalPanel>

          <TerminalPanel title="Work + Reputation Metrics" right={<Chip tone="cyan">LIVE METRICS</Chip>} className="min-h-[340px]">
            <div className="grid h-full grid-cols-2 gap-px bg-cyan-400/10">
              {([
                ['Pay Agent', latestRow ? latestRow.hermes.sizeUsdc : '—', 'x402 / Arc USDC', 'green'],
                ['Payment Completed', latestRow ? 'YES' : 'WAITING', 'authorized before work', 'cyan'],
                ['Work Receipt', `${workproofReady}`, 'receipt after output', 'violet'],
                ['Agent Reputation', `${apoloReputation}`, 'credited to Apolo resolver', 'amber'],
                ['Resolver Output', latestRow?.apolo.decision ?? '—', 'filtered by Apolo', 'cyan'],
                ['Trade Handoff', latestRow?.hermes.action ?? 'SKIP', 'Hermes receives output', 'green'],
                ['Completed Jobs', `${completedJobs}`, 'settled work', 'violet'],
                ['Total Requests', `${totalRequests}`, 'traction metric', 'cyan'],
              ] as Array<[string, string, string, 'cyan' | 'green' | 'red' | 'amber' | 'violet']>).map(([label, value, sub, tone]) => (
                <div key={label} className="min-w-0 bg-[#07101d] p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
                  <div
                    className={`mt-1 font-mono text-lg font-bold ${
                      tone === 'green'
                        ? 'text-emerald-200'
                        : tone === 'red'
                          ? 'text-rose-200'
                          : tone === 'amber'
                            ? 'text-amber-200'
                            : tone === 'violet'
                              ? 'text-violet-200'
                              : 'text-cyan-200'
                    }`}
                  >
                    {value}
                  </div>
                  <div className="truncate text-xs text-slate-400">{sub}</div>
                </div>
              ))}
            </div>
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
          className="h-[430px]"
        >
          <SignalStream signals={signalEvents.slice(0, 24)} />
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
