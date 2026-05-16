'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type Job = {
  id: string;
  agentId: string;
  client: string;
  worker: string;
  budget: string;
  fundedAmount: string;
  createdAt: string;
  deliverableURI: string;
  proofMetadataURI: string;
  approved: boolean;
  status: number;
};

type Proof = {
  tokenId: string;
  jobId: string;
  agentId: string;
  payer: string;
  amountPaid: string;
  mintedAt: string;
  metadataURI: string;
};

type Overview = {
  summary: {
    jobs: number;
    agents: number;
    proofs: number;
    totalBudget: string;
    totalFunded: string;
    settledJobs: number;
    fundedJobs: number;
  };
  jobs: Job[];
  proofs: Proof[];
};

type FeedItem = {
  id: string;
  ts: string;
  agent: 'Pythia' | 'Hermes';
  type: 'signal' | 'payment' | 'decision' | 'trade' | 'balance' | 'error';
  label: string;
  detail: string;
  tx?: string;
};

type AutonomousFeed = {
  items: FeedItem[];
  latest: string | null;
};

type AgentStats = {
  callsServed: number;
  callsFailed: number;
  signalsCorrect: number;
  signalsWrong: number;
  cumulativePnlBps: number;
  calibrationScore: number;
  totalRevenue: string;
  reputationScore: number;
};

type A2AOnChain = {
  chainId: number;
  contracts: Record<string, string>;
  agents: Record<string, { agentId: string; role: string; stats: AgentStats | null }>;
  wallets: { pythia: string; hermes: string };
  balances: { usdc: { hermes: string | null; pythia: string | null } };
  markets: { totalIgnia: number | null; totalMirrors: number | null };
  timestamp: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<FeedItem['type'], string> = {
  signal: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  payment: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  decision: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  trade: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  balance: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
};

const AGENT_COLORS: Record<'Pythia' | 'Hermes', string> = {
  Pythia: 'text-cyan-300',
  Hermes: 'text-amber-300',
};

function short(addr: string) {
  if (!addr || addr.length < 12) return addr || '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatUSDC(raw: string) {
  const n = Number(raw) / 1e6;
  if (n > 0 && n < 0.01) return n.toFixed(3);
  if (n < 1) return n.toFixed(3);
  return n.toFixed(2);
}

function timeAgoFromMs(ms: number) {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 0) return 'now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function timeAgo(unix: string) {
  return timeAgoFromMs(Number(unix) * 1000);
}

function timeAgoIso(iso: string) {
  return timeAgoFromMs(Date.parse(iso));
}

// ─── Sparkline ──────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <div className="h-10" />;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 200;
  const h = 40;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PulseDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
    </span>
  );
}

// ─── Feed Item ──────────────────────────────────────────────────────────────

function FeedRow({ item, isNew }: { item: FeedItem; isNew: boolean }) {
  return (
    <div className={`flex items-start gap-3 border-b border-white/5 px-1 py-2.5 transition-colors duration-700 ${isNew ? 'bg-emerald-950/20' : ''}`}>
      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${TYPE_COLORS[item.type]}`}>
        {item.type}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-[#EAE4D8]">
          <span className={`font-semibold ${AGENT_COLORS[item.agent]}`}>{item.agent}</span>{' '}
          <span className="text-[#9A9A9A]">{item.label}</span>
        </p>
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-[#555]">
          <span>{timeAgoIso(item.ts)}</span>
          {item.tx && (
            <a
              href={`https://explorer.testnet.arc.network/tx/${item.tx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-[#7A7A7A] hover:text-[#C5A67C]"
            >
              {item.tx.slice(0, 10)}…
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function A2ADashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [onchain, setOnchain] = useState<A2AOnChain | null>(null);
  const [feed, setFeed] = useState<AutonomousFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prevFeedIds, setPrevFeedIds] = useState<Set<string>>(new Set());
  const [newFeedIds, setNewFeedIds] = useState<Set<string>>(new Set());
  const [volumeHistory, setVolumeHistory] = useState<number[]>([]);
  const [signalHistory, setSignalHistory] = useState<number[]>([]);
  const [showAllProofs, setShowAllProofs] = useState(false);
  const [_tick, setTick] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const [ovRes, ocRes, fdRes] = await Promise.all([
        fetch('/api/indexer/overview', { cache: 'no-store' }),
        fetch('/api/a2a/status', { cache: 'no-store' }),
        fetch('/api/indexer/autonomous-feed?limit=50', { cache: 'no-store' }),
      ]);
      if (!ovRes.ok) throw new Error(`indexer ${ovRes.status}`);
      const ovData: Overview = await ovRes.json();
      const ocData: A2AOnChain = ocRes.ok ? await ocRes.json() : null;
      const fdData: AutonomousFeed = fdRes.ok ? await fdRes.json() : { items: [], latest: null };

      // Detect new feed items
      const currentIds = new Set(fdData.items.map((i) => i.id));
      if (prevFeedIds.size > 0) {
        const fresh = new Set(Array.from(currentIds).filter((id) => !prevFeedIds.has(id)));
        if (fresh.size > 0) {
          setNewFeedIds(fresh);
          setTimeout(() => setNewFeedIds(new Set()), 4000);
        }
      }
      setPrevFeedIds(currentIds);

      setVolumeHistory((prev) => [...prev.slice(-29), Number(ovData.summary.totalFunded) / 1e6]);
      setSignalHistory((prev) => [
        ...prev.slice(-29),
        ocData?.agents.pythia?.stats?.callsServed ?? prev[prev.length - 1] ?? 0,
      ]);

      setOverview(ovData);
      if (ocData) setOnchain(ocData);
      setFeed(fdData);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'fetch failed');
    }
  }, [prevFeedIds]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tick every second so timeAgo recomputes for live feel
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const summary = overview?.summary;
  const pythia = onchain?.agents.pythia;
  const hermes = onchain?.agents.hermes;
  const latestFeedMs = feed?.latest ? Date.parse(feed.latest) : 0;
  const isLive = latestFeedMs > 0 && Date.now() - latestFeedMs < 120_000;
  const proofTxs = (feed?.items ?? []).filter((item) => item.tx);
  const visibleProofTxs = showAllProofs ? proofTxs : proofTxs.slice(0, 3);

  return (
    <main className="min-h-screen bg-[#0A0A0A] text-[#EAE4D8] selection:bg-[#C5A67C]/20">
      {/* ─── Header ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-white/5 bg-[#0A0A0A]/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <PulseDot active={isLive} />
            <h1 className="font-mono text-sm font-medium tracking-tight">
              ArcLayer <span className="text-[#C5A67C]">A2A Economy</span>
            </h1>
          </div>
          <div className="flex items-center gap-4 font-mono text-[10px] text-[#555]">
            <span>Arc Testnet · 5042002</span>
            <span className={isLive ? 'text-emerald-400' : 'text-amber-400'}>
              {isLive ? 'Autonomous · LIVE' : 'Autonomous · idle'}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {error && (
          <div className="mb-6 rounded border border-red-500/20 bg-red-950/10 px-4 py-3 font-mono text-xs text-red-300">
            ⚠ {error}
          </div>
        )}

        {/* ─── Hero: Autonomous Agents (Pythia + Hermes) ───────────────── */}
        <section className="grid gap-4 md:grid-cols-2">
          <AgentHeroCard
            name="Pythia"
            role="Signal Oracle"
            color="cyan"
            stats={pythia?.stats || null}
            agentId={pythia?.agentId}
            description="Sells crypto signals (BTC/ETH/SOL) for 0.01 USDC via x402 EIP-3009."
            isLive={isLive}
          />
          <AgentHeroCard
            name="Hermes"
            role="Autonomous Trader"
            color="amber"
            stats={hermes?.stats || null}
            agentId={hermes?.agentId}
            description="Buys signals from Pythia, queries Polymarket, trades Ignia prediction markets."
            isLive={isLive}
          />
        </section>

        {/* ─── KPI Strip ───────────────────────────────────────────────── */}
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KPICard label="Signals Served" value={pythia?.stats?.callsServed ?? '—'} accent />
          <KPICard label="Ignia Trades" value={hermes?.stats?.callsServed ?? '—'} accent />
          <KPICard label="Ignia Markets" value={onchain?.markets.totalIgnia ?? '—'} />
          <KPICard label="Mirrors" value={onchain?.markets.totalMirrors ?? '—'} />
          <KPICard label="Marketplace Jobs" value={summary?.jobs ?? '—'} />
          <KPICard label="Volume USDC" value={summary ? formatUSDC(summary.totalFunded) : '—'} accent />
        </section>

        {/* ─── Sparklines ──────────────────────────────────────────────── */}
        <section className="mt-6 grid gap-3 md:grid-cols-2">
          <SparklineCard label="Signals Served · Live" data={signalHistory} color="#22D3EE" />
          <SparklineCard label="Marketplace Volume USDC · Live" data={volumeHistory} color="#C5A67C" />
        </section>

        {/* ─── x402 Charge Notice · Per-Execution Micropayment Proof ──── */}
        <section className="mt-6 rounded border border-emerald-500/20 bg-emerald-950/[0.06] p-4">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <p className="font-mono text-[10px] uppercase tracking-widest text-emerald-300">
                x402 · per-execution charge (live on-chain reads)
              </p>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px]">
              <div>
                <span className="text-[#7A7A7A]">price/call</span>{' '}
                <span className="text-[#EAE4D8]">0.01 USDC</span>
              </div>
              <div>
                <span className="text-[#7A7A7A]">scheme</span>{' '}
                <span className="text-[#EAE4D8]">EIP-3009 · exact</span>
              </div>
              <div>
                <span className="text-[#7A7A7A]">calls served</span>{' '}
                <span className="text-cyan-300">{pythia?.stats?.callsServed ?? 0}</span>
              </div>
              <div>
                <span className="text-[#7A7A7A]">total deducted</span>{' '}
                <span className="text-emerald-300">
                  {pythia?.stats?.totalRevenue ? formatUSDC(pythia.stats.totalRevenue) : '0.00'} USDC
                </span>
              </div>
              <div>
                <span className="text-[#7A7A7A]">pythia revenue (on-chain)</span>{' '}
                <span className="text-amber-300">
                  {pythia?.stats?.totalRevenue ? formatUSDC(pythia.stats.totalRevenue) : '0.00'} USDC
                </span>
              </div>
            </div>
          </div>

          {/* Balance Snapshot · live wallet reads from Arc Testnet */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-amber-500/15 bg-black/30 p-3">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[9.5px] uppercase tracking-widest text-amber-300/80">Hermes · payer</p>
                <a
                  href={`https://explorer.testnet.arc.network/address/${onchain?.wallets?.hermes ?? ''}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[9.5px] text-[#7A7A7A] hover:text-amber-300"
                >
                  {short(onchain?.wallets?.hermes ?? '')} ↗
                </a>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-[18px] text-amber-300">
                  {onchain?.balances?.usdc?.hermes ? formatUSDC(onchain.balances.usdc.hermes) : '—'}
                </span>
                <span className="font-mono text-[10px] text-[#7A7A7A]">USDC (live)</span>
              </div>
              <p className="mt-1 font-mono text-[9.5px] text-[#555]">
                Each x402 settlement deducts 0.01 USDC from this wallet on-chain.
              </p>
            </div>

            <div className="rounded border border-cyan-500/15 bg-black/30 p-3">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[9.5px] uppercase tracking-widest text-cyan-300/80">Pythia · receiver</p>
                <a
                  href={`https://explorer.testnet.arc.network/address/${onchain?.wallets?.pythia ?? ''}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[9.5px] text-[#7A7A7A] hover:text-cyan-300"
                >
                  {short(onchain?.wallets?.pythia ?? '')} ↗
                </a>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-[18px] text-cyan-300">
                  {onchain?.balances?.usdc?.pythia ? formatUSDC(onchain.balances.usdc.pythia) : '—'}
                </span>
                <span className="font-mono text-[10px] text-[#7A7A7A]">USDC (live)</span>
              </div>
              <p className="mt-1 font-mono text-[9.5px] text-[#555]">
                Receives 0.01 USDC per signal. Counter on-chain via ReputationRegistry.totalRevenue.
              </p>
            </div>
          </div>

          <p className="mt-3 font-mono text-[10px] leading-[1.6] text-[#7A7A7A]">
            All numbers above are direct on-chain reads (not cached, not derived from indexer guesses).
            "calls served" + "total deducted" come from{' '}
            <span className="text-emerald-300/80">ReputationRegistry.getStats(Pythia)</span>.
            Wallet balances come from{' '}
            <span className="text-emerald-300/80">USDC.balanceOf()</span> on Arc Testnet (chain {onchain?.chainId ?? '5042002'}).
            Each tx hash below is verifiable on the explorer.
          </p>
        </section>

        {/* ─── Live Proof Transactions ────────────────────────────────── */}
        {proofTxs.length > 0 && (
          <section className="mt-6 rounded border border-[#C5A67C]/20 bg-[#C5A67C]/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <p className="font-mono text-[10px] uppercase tracking-widest text-[#C5A67C]">
                  Live Proof · On-Chain Transactions
                </p>
              </div>
              {proofTxs.length > 3 && (
                <button
                  onClick={() => setShowAllProofs(!showAllProofs)}
                  className="font-mono text-[10px] text-[#7A7A7A] hover:text-[#C5A67C] transition-colors"
                >
                  {showAllProofs ? 'Show Less' : `Show All (${proofTxs.length})`}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {visibleProofTxs.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded border border-white/5 bg-black/30 px-3 py-2.5 font-mono text-xs"
                >
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${TYPE_COLORS[item.type]}`}>
                    {item.type}
                  </span>
                  <span className={`shrink-0 font-semibold ${AGENT_COLORS[item.agent]}`}>{item.agent}</span>
                  <span className="min-w-0 flex-1 truncate text-[#9A9A9A]">{item.label}</span>
                  <a
                    href={`https://explorer.testnet.arc.network/tx/${item.tx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-[#C5A67C] hover:text-[#EAE4D8] transition-colors"
                  >
                    {item.tx!.slice(0, 10)}…{item.tx!.slice(-6)}
                  </a>
                  <span className="shrink-0 text-[10px] text-[#555]">{timeAgoIso(item.ts)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Main Grid: Autonomous Feed + Loop Diagram ───────────────── */}
        <section className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded border border-white/5 bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#555]">
                Autonomous Activity · Pythia ↔ Hermes
              </p>
              <span className="font-mono text-[10px] text-[#333]">
                {feed?.items.length ?? 0} events · last {feed?.latest ? timeAgoIso(feed.latest) : '—'}
              </span>
            </div>
            <div className="max-h-[560px] overflow-y-auto pr-1">
              {!feed || feed.items.length === 0 ? (
                <p className="py-8 text-center font-mono text-xs text-[#333]">
                  Waiting for autonomous loop…
                </p>
              ) : (
                feed.items.map((item) => (
                  <FeedRow key={item.id} item={item} isNew={newFeedIds.has(item.id)} />
                ))
              )}
            </div>
          </div>

          <div className="space-y-4">
            <LoopCard summary={summary} pythiaServed={pythia?.stats?.callsServed} />
            <ContractsCard contracts={onchain?.contracts} />
          </div>
        </section>

        {/* ─── Marketplace Section (manual JobEscrow) ──────────────────── */}
        {summary && summary.jobs > 0 && (
          <section className="mt-6 rounded border border-white/5 bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#555]">
                Marketplace Jobs · JobEscrow
              </p>
              <span className="font-mono text-[10px] text-[#333]">
                {summary.settledJobs}/{summary.jobs} settled
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {overview!.proofs.slice(0, 6).map((proof) => (
                <div key={proof.tokenId} className="rounded border border-white/5 bg-black/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-[#C5A67C]">Proof #{proof.tokenId}</span>
                    <span className="font-mono text-[10px] text-[#555]">{timeAgo(proof.mintedAt)}</span>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-[#7A7A7A]">
                    Job #{proof.jobId} · {formatUSDC(proof.amountPaid)} USDC
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-[#444]">payer {short(proof.payer)}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-10 border-t border-white/5 pt-4 font-mono text-[10px] text-[#333]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>ArcLayer Protocol · Autonomous Agent Economy on Arc Network</span>
            <span>Source: on-chain indexer + agent telemetry · No simulated values</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function AgentHeroCard({
  name,
  role,
  color,
  stats,
  agentId,
  description,
  isLive,
}: {
  name: string;
  role: string;
  color: 'cyan' | 'amber';
  stats: AgentStats | null;
  agentId?: string;
  description: string;
  isLive: boolean;
}) {
  const accentText = color === 'cyan' ? 'text-cyan-300' : 'text-amber-300';
  const accentBorder = color === 'cyan' ? 'border-cyan-500/20' : 'border-amber-500/20';
  return (
    <div className={`rounded border bg-white/[0.02] p-5 ${accentBorder}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className={`font-mono text-[10px] uppercase tracking-widest ${accentText}`}>{role}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">{name}</h2>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[9px] ${
            isLive ? 'border-emerald-500/30 text-emerald-300' : 'border-zinc-600/30 text-zinc-500'
          }`}
        >
          {isLive ? '● running' : '○ idle'}
        </span>
      </div>
      <p className="mt-2 font-mono text-[11px] leading-5 text-[#7A7A7A]">{description}</p>
      <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-xs">
        <Stat label="Calls served" value={stats?.callsServed ?? '—'} />
        <Stat label="Reputation" value={stats?.reputationScore ?? '—'} />
        <Stat label="Calibration" value={stats?.calibrationScore ?? '—'} />
        <Stat label="Revenue" value={stats ? formatUSDC(stats.totalRevenue) : '—'} />
      </div>
      {agentId && (
        <p className="mt-3 truncate font-mono text-[10px] text-[#444]" title={agentId}>
          {agentId.slice(0, 14)}…{agentId.slice(-12)}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-white/5 bg-black/30 px-3 py-2">
      <p className="text-[9px] uppercase tracking-widest text-[#555]">{label}</p>
      <p className="mt-1 text-sm text-[#EAE4D8]">{value}</p>
    </div>
  );
}

function KPICard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded border border-white/5 bg-white/[0.02] p-4">
      <p className="font-mono text-[9px] uppercase tracking-widest text-[#555]">{label}</p>
      <p className={`mt-2 font-mono text-2xl font-medium ${accent ? 'text-[#C5A67C]' : 'text-[#EAE4D8]'}`}>
        {value}
      </p>
    </div>
  );
}

function SparklineCard({ label, data, color }: { label: string; data: number[]; color: string }) {
  return (
    <div className="rounded border border-white/5 bg-white/[0.02] p-4">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#555]">{label}</p>
      <Sparkline data={data.length > 1 ? data : [0, 0]} color={color} />
    </div>
  );
}

function LoopCard({ summary, pythiaServed }: { summary?: Overview['summary']; pythiaServed?: number }) {
  const steps = [
    { label: 'Hermes wakes', icon: '⏱', active: true },
    { label: 'Buys signal', icon: '📡', active: (pythiaServed ?? 0) > 0 },
    { label: 'x402 settle', icon: '💰', active: (pythiaServed ?? 0) > 0 },
    { label: 'Polymarket', icon: '🌐', active: true },
    { label: 'Ignia trade', icon: '🎯', active: (summary?.fundedJobs ?? 0) > 0 || (pythiaServed ?? 0) > 0 },
    { label: 'Reputation', icon: '⭐', active: true },
  ];
  return (
    <div className="rounded border border-white/5 bg-white/[0.02] p-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#555]">Trade Cycle</p>
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div
            key={s.label}
            className={`flex items-center gap-3 rounded border px-3 py-2 font-mono text-xs transition-colors ${
              s.active
                ? 'border-[#C5A67C]/30 bg-[#C5A67C]/5 text-[#EAE4D8]'
                : 'border-white/5 text-[#444]'
            }`}
          >
            <span className="text-[#7A7A7A]">{String(i + 1).padStart(2, '0')}</span>
            <span>{s.icon}</span>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContractsCard({ contracts }: { contracts?: Record<string, string> }) {
  if (!contracts) return null;
  return (
    <div className="rounded border border-white/5 bg-white/[0.02] p-4">
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#555]">Contracts</p>
      <div className="space-y-1.5 font-mono text-[10px]">
        {Object.entries(contracts).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2">
            <span className="text-[#7A7A7A]">{k}</span>
            <a
              href={`https://explorer.testnet.arc.network/address/${v}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#9A9A9A] hover:text-[#C5A67C]"
            >
              {short(v)}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
