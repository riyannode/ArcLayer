'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { waitForTransactionReceipt } from '@wagmi/core';
import { useWriteContract } from 'wagmi';
import { config } from '@/lib/wagmi';
import type { Hex } from 'viem';

const AGENT_REGISTRY_ADDRESS = '0xB263336055dD65FF501e36CA39941760D943703C' as const;
const AGENT_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'deactivateAgent',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'bytes32' }],
    outputs: [],
  },
] as const;
import type {
  A2AOnChain,
  AgentCategory,
  AgentStats,
  AutonomousFeed,
  FeedItem,
  NetworkAgent,
  Overview,
  Proof,
  RegisteredAgent,
} from '@/types/agent-network';
import { buildAgentNetwork } from '@/lib/a2a/build-agent-network';
import { AgentFilterBar, AGENT_FILTERS } from '@/components/a2a/AgentFilterBar';
import { AgentNetworkCard, EmptyAgentState } from '@/components/a2a/AgentNetworkCard';
import { AgentDetailDrawer } from '@/components/a2a/AgentDetailDrawer';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<FeedItem['type'], string> = {
  signal: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  payment: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  decision: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  trade: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  balance: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
};

const AGENT_COLORS: Record<FeedItem['agent'], string> = {
  Pythia: 'text-cyan-200',
  Ignia: 'text-cyan-300',
  Apolo: 'text-violet-300',
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
              href={`https://testnet.arcscan.app/tx/${item.tx}`}
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

export default function A2ADashboardPageRoute() {
  return (
    <Suspense fallback={null}>
      <A2ADashboardPage />
    </Suspense>
  );
}

function A2ADashboardPage() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get('focus')?.trim() || null;
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
  const [filter, setFilter] = useState<AgentCategory>('all');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(focusId);
  const [registeredAgents, setRegisteredAgents] = useState<RegisteredAgent[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('arclayer_hidden_agents');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  useEffect(() => {
    if (focusId) setSelectedAgentId(focusId);
  }, [focusId]);

  const hideAgent = useCallback((agentId: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(agentId);
      localStorage.setItem('arclayer_hidden_agents', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  const { writeContractAsync } = useWriteContract();
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const deactivateAgent = useCallback(async (agent: NetworkAgent) => {
    if (!agent.id || !agent.id.startsWith('0x')) {
      alert(`Cannot deactivate: invalid agent ID format.\nThis agent isn't registered on-chain.`);
      return;
    }
    try {
      setDeactivatingId(agent.id);
      const txHash = await writeContractAsync({
        address: AGENT_REGISTRY_ADDRESS,
        abi: AGENT_REGISTRY_ABI,
        functionName: 'deactivateAgent',
        args: [agent.id as Hex],
      });
      await waitForTransactionReceipt(config, { hash: txHash });
      alert(`✓ ${agent.name} deactivated on-chain.\n\nTx: ${txHash}`);
      hideAgent(agent.id);
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Unknown error';
      alert(`Deactivation failed:\n${msg}\n\nNote: Only the agent controller can deactivate.`);
    } finally {
      setDeactivatingId(null);
    }
  }, [writeContractAsync, hideAgent]);

  const unhideAgent = useCallback((agentId: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.delete(agentId);
      localStorage.setItem('arclayer_hidden_agents', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const cacheBust = Date.now();
      const [ovRes, ocRes, fdRes, regRes] = await Promise.all([
        fetch(`/api/indexer/overview?t=${cacheBust}`, { cache: 'no-store' }),
        fetch(`/api/a2a/status?t=${cacheBust}`, { cache: 'no-store' }),
        fetch(`/api/indexer/autonomous-feed?limit=50&t=${cacheBust}`, { cache: 'no-store' }),
        fetch(`/api/a2a/agents?t=${cacheBust}`, { cache: 'no-store' }),
      ]);
      if (!ovRes.ok) throw new Error(`indexer ${ovRes.status}`);
      const ovData: Overview = await ovRes.json();
      const ocData: A2AOnChain = ocRes.ok ? await ocRes.json() : null;
      const fdData: AutonomousFeed = fdRes.ok ? await fdRes.json() : { items: [], latest: null };
      const regData = regRes.ok ? await regRes.json().catch(() => ({ agents: [] })) : { agents: [] };

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

      const feedSignalCount = fdData.items.filter((item) => item.agent === 'Apolo' && item.type === 'payment').length;
      const signalCount = Math.max(ocData?.agents.pythia?.stats?.callsServed ?? 0, feedSignalCount);

      // Volume sparkline: JobEscrow funded + x402 revenue (Apolo + Hermes)
      const jobFunded = Number(ovData.summary.totalFunded || '0') / 1e6;
      const pythiaRev = Number(ocData?.agents.pythia?.stats?.totalRevenue || '0') / 1e6;
      const hermesRev = Number(ocData?.agents.hermes?.stats?.totalRevenue || '0') / 1e6;
      const totalVol = jobFunded + pythiaRev + hermesRev;

      setVolumeHistory((prev) => [...prev.slice(-29), totalVol]);
      setSignalHistory((prev) => [
        ...prev.slice(-29),
        signalCount || prev[prev.length - 1] || 0,
      ]);

      setOverview(ovData);
      if (ocData) setOnchain(ocData);
      setFeed(fdData);
      setRegisteredAgents(Array.isArray(regData.agents) ? regData.agents : []);
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
  const ignia = onchain?.agents.pythia; // legacy on-chain key, branded as Ignia/Apolo
  const hermes = onchain?.agents.hermes;
  const latestFeedMs = feed?.latest ? Date.parse(feed.latest) : 0;
  const isLive = latestFeedMs > 0 && Date.now() - latestFeedMs < 120_000;
  const proofTxs = (feed?.items ?? []).filter((item) => item.tx);
  const visibleProofTxs = showAllProofs ? proofTxs : proofTxs.slice(0, 3);
  const networkAgents = buildAgentNetwork({ onchain, overview, feed, isLive, registeredAgents, hiddenIds });
  const filteredAgents = filter === 'all' ? networkAgents : networkAgents.filter((agent) => agent.categories.includes(filter));
  const selectedAgent = networkAgents.find((agent) => agent.id === selectedAgentId) ?? null;
  const activeFilterLabel = AGENT_FILTERS.find((item) => item.key === filter)?.label ?? 'All agents';

  // Live-derived counters from autonomous feed (compensates for ReputationRegistry not being updated by agent telemetry)
  const feedItems = feed?.items ?? [];
  const feedSignalsServed = feedItems.filter((item) => item.agent === 'Apolo' && item.type === 'payment').length;
  const feedIgniaTrades = feedItems.filter((item) =>
    item.agent === 'Hermes' && item.type === 'trade' && item.label.toLowerCase().includes('ignia')
  ).length;
  const liveSignalsServed = Math.max(ignia?.stats?.callsServed ?? 0, feedSignalsServed);
  const liveIgniaTrades = Math.max(hermes?.stats?.callsServed ?? 0, feedIgniaTrades);

  // Total volume = JobEscrow funded (manual jobs) + x402 signal revenue (Apolo + Hermes totalRevenue)
  const jobsFundedRaw = summary ? BigInt(summary.totalFunded || '0') : BigInt(0);
  const apoloRevenueRaw = ignia?.stats?.totalRevenue ? BigInt(ignia.stats.totalRevenue) : BigInt(0);
  const hermesRevenueRaw = hermes?.stats?.totalRevenue ? BigInt(hermes.stats.totalRevenue) : BigInt(0);
  const totalVolumeRaw = jobsFundedRaw + apoloRevenueRaw + hermesRevenueRaw;

  // Total USDC held by autonomous agents (live wallet balance)
  const igniaBal = onchain?.balances?.usdc?.pythia ? BigInt(onchain.balances.usdc.pythia) : BigInt(0);
  const hermesBal = onchain?.balances?.usdc?.hermes ? BigInt(onchain.balances.usdc.hermes) : BigInt(0);
  const totalAgentBalanceRaw = igniaBal + hermesBal;

  return (
    <main className="min-h-screen bg-[#0A0A0A] text-[#EAE4D8] selection:bg-[#C5A67C]/20">
      {/* ─── Header ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-white/5 bg-[#0A0A0A]/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <PulseDot active={isLive} />
            <h1 className="font-mono text-sm font-medium tracking-tight">
              ArcLayer <span className="text-[#C5A67C]">A2A Agent Registry</span>
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

        {/* ─── Hero Banner ────────────────────────────────────────────────── */}
        <section className="mb-10 overflow-hidden rounded-sm border border-[#C5A67C]/20 bg-gradient-to-br from-[#0A0A0A] via-[#0F0D0A] to-[#0A0A0A]">
          <div className="relative px-6 py-10 sm:px-10 sm:py-14">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(197,166,124,0.08),transparent_50%),radial-gradient(circle_at_80%_70%,rgba(52,211,153,0.05),transparent_40%)]" />
            <div className="relative">
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#C5A67C]">ArcLayer Protocol</div>
              <h2 className="mt-3 text-3xl font-black uppercase tracking-[0.08em] text-[#EAE4D8] sm:text-4xl">
                Autonomous Agent Economy
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[#EAE4D8]/70">
                Discover, register, and monetize AI agents on Arc Network. Every agent pays and gets paid via x402 — no middlemen, no custody, no trust assumptions. Agents earn reputation through verifiable work receipts settled on-chain.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a href="/live-a2a-agent" className="inline-flex items-center gap-2 rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] transition hover:bg-[#C5A67C]/20">
                  Browse Network →
                </a>
                <a href="/register/autonomous" className="inline-flex items-center gap-2 rounded-sm border border-emerald-300/30 bg-emerald-400/[0.06] px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-300 transition hover:bg-emerald-400/10">
                  Build on Protocol →
                </a>
              </div>
              <div className="mt-6 flex flex-wrap gap-4 font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/45">
                <span>x402 Payments</span>
                <span>·</span>
                <span>On-Chain Registry</span>
                <span>·</span>
                <span>Agent Reputation</span>
                <span>·</span>
                <span>Work Receipts</span>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Page Title · A2A registry only ───────────────────────────── */}
        <section className="mb-6">
          <h2 className="text-2xl font-semibold tracking-tight text-[#EAE4D8]">
            Registered A2A Agents
          </h2>
          <p className="mt-1 max-w-3xl font-mono text-[12px] leading-5 text-[#9C9080]">
            Browse autonomous agents registered in the ArcLayer A2A network. Select an agent to inspect profile,
            reputation, receipts, and on-chain activity.
          </p>
        </section>

        {/* ─── Autonomous Agent Network · selectable agent cards ──────── */}
        <section className="mb-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#777]">
                Registered agents · {filteredAgents.length} of {networkAgents.length}
              </p>
              {hiddenIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    Array.from(hiddenIds).forEach(unhideAgent);
                  }}
                  className="mt-1 font-mono text-[10px] text-[#555] underline decoration-dotted hover:text-[#C5A67C]"
                >
                  restore {hiddenIds.size} hidden agent{hiddenIds.size > 1 ? 's' : ''}
                </button>
              )}
            </div>
            <AgentFilterBar active={filter} onChange={setFilter} />
          </div>

          {filteredAgents.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredAgents.map((agent) => (
                <AgentNetworkCard
                  key={agent.id}
                  agent={agent}
                  selected={agent.id === selectedAgentId}
                  onSelect={() => setSelectedAgentId(agent.id)}
                />
              ))}
            </div>
          ) : (
            <EmptyAgentState label={activeFilterLabel} />
          )}

          {filter === 'all' && networkAgents.length <= 2 && (
            <div className="rounded border border-dashed border-white/10 bg-white/[0.015] p-4 text-center">
              <p className="font-mono text-[11px] text-[#777]">
                <span className="text-[#C5A67C]">No additional autonomous agents registered yet.</span>{' '}
                Register an agent to make it appear in the network.
              </p>
            </div>
          )}
        </section>

        <footer className="mt-10 border-t border-white/5 pt-4 font-mono text-[10px] text-[#333]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>ArcLayer Protocol · Autonomous Agent Economy on Arc Network</span>
            <span>Source: on-chain indexer + agent telemetry · No simulated values</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[#555]">
            <a href="/jobs" className="rounded border border-white/10 bg-white/[0.02] px-2 py-1 text-[#C5A67C] hover:border-[#C5A67C]/40">
              ↗ Manual Job Marketplace · /jobs
            </a>
            <span>Same protocol stack, human-driven entry point.</span>
          </div>
        </footer>
      </div>

      <AgentDetailDrawer agent={selectedAgent} onClose={() => setSelectedAgentId(null)} onHide={hideAgent} onDeactivate={deactivateAgent} isDeactivating={deactivatingId === selectedAgent?.id} />
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
  wallet,
  balance,
  description,
  isLive,
}: {
  name: string;
  role: string;
  color: 'cyan' | 'amber';
  stats: AgentStats | null;
  agentId?: string;
  wallet?: string;
  balance?: string | null;
  description: string;
  isLive: boolean;
}) {
  const accentText = color === 'cyan' ? 'text-cyan-300' : 'text-amber-300';
  const accentBorder = color === 'cyan' ? 'border-cyan-500/20' : 'border-amber-500/20';
  const [copied, setCopied] = useState(false);
  const copyWallet = async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked, no-op */
    }
  };

  return (
    <div className={`rounded border bg-white/[0.02] p-5 ${accentBorder}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`font-mono text-[10px] uppercase tracking-widest ${accentText}`}>{role}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight">{name}</h2>
            {wallet && (
              <button
                type="button"
                onClick={copyWallet}
                title={`Copy ${name} wallet: ${wallet}`}
                className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-[#7A7A7A] transition-colors hover:border-[#C5A67C]/40 hover:text-[#C5A67C]"
              >
                {copied ? '✓ copied' : 'copy wallet'}
              </button>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] ${
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
        <Stat
          label="Winrate"
          value={
            stats && (stats.signalsCorrect + stats.signalsWrong) > 0
              ? `${((stats.signalsCorrect / (stats.signalsCorrect + stats.signalsWrong)) * 100).toFixed(1)}%`
              : '—'
          }
        />
        <Stat
          label="PnL (bps)"
          value={
            typeof stats?.cumulativePnlBps === 'number'
              ? `${stats.cumulativePnlBps >= 0 ? '+' : ''}${stats.cumulativePnlBps}`
              : '—'
          }
        />
      </div>
      {/* Live USDC balance · refreshes every 8s */}
      <div className={`mt-3 rounded border ${accentBorder} bg-black/30 px-3 py-2`}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-mono text-[9px] uppercase tracking-widest text-[#555]">USDC balance · live</p>
          <span className="font-mono text-[8px] text-emerald-400/70">● synced</span>
        </div>
        <p className={`mt-1 font-mono text-base ${accentText}`}>
          {balance ? `${formatUSDC(balance)} USDC` : '—'}
        </p>
      </div>
      <div className="mt-3 space-y-1 font-mono text-[10px] text-[#444]">
        {wallet && (
          <a
            href={`https://testnet.arcscan.app/address/${wallet}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate hover:text-[#C5A67C]"
            title={wallet}
          >
            wallet {wallet.slice(0, 14)}…{wallet.slice(-12)} ↗
          </a>
        )}
        {agentId && (
          <p className="truncate" title={agentId}>
            agent {agentId.slice(0, 14)}…{agentId.slice(-12)}
          </p>
        )}
      </div>
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

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded border border-[#C5A67C]/10 bg-black/30 p-3">
      <p className="font-mono text-[9px] uppercase tracking-widest text-[#777]">{label}</p>
      <p className="mt-1.5 font-mono text-xl font-medium text-[#EAE4D8]">{value}</p>
      {sub && <p className="mt-0.5 font-mono text-[9px] text-[#555]">{sub}</p>}
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
