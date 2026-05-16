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

type Agent = {
  agentId: string;
  controller: string;
  metadataURI: string;
  registeredAt: string;
  score: string;
  jobs: string[];
  proofTokenIds: string[];
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
  agents: Agent[];
  proofs: Proof[];
};

type A2AOnChain = {
  chainId: number;
  agents: Record<string, { agentId: string; role: string; stats: any }>;
  markets: { totalIgnia: number | null; totalMirrors: number | null };
  timestamp: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<number, string> = {
  0: 'Created',
  1: 'Funded',
  2: 'Assigned',
  3: 'Delivered',
  4: 'Evaluated',
  5: 'Settled',
};

const STATUS_COLORS: Record<number, string> = {
  0: 'bg-zinc-700',
  1: 'bg-amber-600',
  2: 'bg-blue-600',
  3: 'bg-purple-600',
  4: 'bg-cyan-600',
  5: 'bg-emerald-600',
};

function short(addr: string) {
  if (!addr || addr.length < 12) return addr || '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatUSDC(raw: string) {
  const n = Number(raw) / 1e6;
  return n < 0.01 && n > 0 ? '<0.01' : n.toFixed(2);
}

function timeAgo(unix: string) {
  const diff = Math.floor(Date.now() / 1000) - Number(unix);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function loopStage(job: Job): string {
  if (job.status === 5) return 'SETTLED';
  if (job.status === 4) return 'EVALUATED';
  if (job.status === 3) return 'DELIVERED';
  if (Number(job.fundedAmount) > 0 && job.status >= 1) return 'FUNDED';
  return 'CREATED';
}

// ─── Sparkline Component ─────────────────────────────────────────────────────

function Sparkline({ data, color = '#C5A67C' }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
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
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Pulse Dot ───────────────────────────────────────────────────────────────

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

// ─── Activity Feed Item ──────────────────────────────────────────────────────

function ActivityItem({ job, isNew }: { job: Job; isNew: boolean }) {
  const stage = loopStage(job);
  return (
    <div className={`flex items-center gap-3 border-b border-white/5 py-3 px-1 transition-colors duration-700 ${isNew ? 'bg-emerald-950/20' : ''}`}>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white ${STATUS_COLORS[job.status] || 'bg-zinc-700'}`}>
        {stage}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs text-[#EAE4D8]">
          Job #{job.id} · <span className="text-[#7A7A7A]">{short(job.worker)}</span>
        </p>
        <p className="font-mono text-[10px] text-[#555]">
          {Number(job.fundedAmount) > 0 ? `${formatUSDC(job.fundedAmount)} USDC` : 'unfunded'} · {timeAgo(job.createdAt)}
        </p>
      </div>
      {job.status === 5 && (
        <span className="text-emerald-400 text-xs">✓</span>
      )}
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function A2ADashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [onchain, setOnchain] = useState<A2AOnChain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prevJobIds, setPrevJobIds] = useState<Set<string>>(new Set());
  const [newJobIds, setNewJobIds] = useState<Set<string>>(new Set());
  const [volumeHistory, setVolumeHistory] = useState<number[]>([]);
  const [jobCountHistory, setJobCountHistory] = useState<number[]>([]);
  const tickRef = useRef(0);

  const fetchData = useCallback(async () => {
    try {
      const [ovRes, ocRes] = await Promise.all([
        fetch('/api/indexer/overview', { cache: 'no-store' }),
        fetch('/api/a2a/status', { cache: 'no-store' }),
      ]);
      if (!ovRes.ok) throw new Error(`indexer ${ovRes.status}`);
      const ovData: Overview = await ovRes.json();
      const ocData: A2AOnChain = ocRes.ok ? await ocRes.json() : null;

      // Detect new jobs for highlight
      const currentIds = new Set(ovData.jobs.map(j => j.id));
      if (prevJobIds.size > 0) {
        const fresh = new Set(Array.from(currentIds).filter(id => !prevJobIds.has(id)));
        setNewJobIds(fresh);
        if (fresh.size > 0) setTimeout(() => setNewJobIds(new Set()), 3000);
      }
      setPrevJobIds(currentIds);

      // Accumulate history for sparklines
      setVolumeHistory(prev => [...prev.slice(-29), Number(ovData.summary.totalFunded) / 1e6]);
      setJobCountHistory(prev => [...prev.slice(-29), ovData.summary.jobs]);

      setOverview(ovData);
      if (ocData) setOnchain(ocData);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'fetch failed');
    }
    tickRef.current++;
  }, [prevJobIds]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = overview?.summary;
  const recentJobs = overview?.jobs?.slice(0, 12) || [];
  const activeAgents = overview?.agents?.filter(a => a.jobs.length > 0) || [];

  return (
    <main className="min-h-screen bg-[#0A0A0A] text-[#EAE4D8] selection:bg-[#C5A67C]/20">
      {/* Header */}
      <header className="border-b border-white/5 px-6 py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <PulseDot active={!error} />
            <h1 className="font-mono text-sm font-medium tracking-tight">
              ArcLayer <span className="text-[#C5A67C]">A2A Economy</span>
            </h1>
          </div>
          <div className="flex items-center gap-4 font-mono text-[10px] text-[#555]">
            <span>Arc Testnet · 5042002</span>
            <span>Refresh 10s</span>
            {onchain?.timestamp && <span>{new Date(onchain.timestamp).toLocaleTimeString()}</span>}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {error && (
          <div className="mb-6 rounded border border-red-500/20 bg-red-950/10 px-4 py-3 font-mono text-xs text-red-300">
            ⚠ {error}
          </div>
        )}

        {/* ─── KPI Strip ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <KPICard label="Total Jobs" value={summary?.jobs ?? '—'} />
          <KPICard label="Agents" value={summary?.agents ?? '—'} />
          <KPICard label="Settled" value={summary?.settledJobs ?? '—'} accent />
          <KPICard label="Proofs Minted" value={summary?.proofs ?? '—'} />
          <KPICard label="Volume (USDC)" value={summary ? formatUSDC(summary.totalFunded) : '—'} accent />
          <KPICard label="Ignia Markets" value={onchain?.markets.totalIgnia ?? '—'} />
        </div>

        {/* ─── Sparklines ────────────────────────────────────────────── */}
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <div className="rounded border border-white/5 bg-white/[0.02] p-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#555]">Volume (USDC) — Live</p>
            <Sparkline data={volumeHistory.length > 1 ? volumeHistory : [0, 0]} color="#C5A67C" />
          </div>
          <div className="rounded border border-white/5 bg-white/[0.02] p-4">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[#555]">Job Count — Live</p>
            <Sparkline data={jobCountHistory.length > 1 ? jobCountHistory : [0, 0]} color="#6EE7B7" />
          </div>
        </div>

        {/* ─── Main Grid: Activity Feed + Agent Cards ────────────────── */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Activity Feed */}
          <div className="lg:col-span-2 rounded border border-white/5 bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#555]">Trade Cycle Feed</p>
              <span className="font-mono text-[10px] text-[#333]">latest 12</span>
            </div>
            <div className="max-h-[480px] overflow-y-auto scrollbar-thin">
              {recentJobs.length === 0 ? (
                <p className="py-8 text-center font-mono text-xs text-[#333]">Waiting for data…</p>
              ) : (
                recentJobs.map(job => (
                  <ActivityItem key={job.id} job={job} isNew={newJobIds.has(job.id)} />
                ))
              )}
            </div>
          </div>

          {/* Active Agents */}
          <div className="rounded border border-white/5 bg-white/[0.02] p-4">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#555]">Active Agents</p>
            <div className="space-y-3 max-h-[480px] overflow-y-auto">
              {activeAgents.map(agent => (
                <AgentCard key={agent.agentId} agent={agent} />
              ))}
              {activeAgents.length === 0 && (
                <p className="py-8 text-center font-mono text-xs text-[#333]">No active agents</p>
              )}
            </div>
          </div>
        </div>

        {/* ─── Economy Loop Diagram ──────────────────────────────────── */}
        <div className="mt-6 rounded border border-white/5 bg-white/[0.02] p-6">
          <p className="mb-4 font-mono text-[10px] uppercase tracking-widest text-[#555]">Autonomous Trade Cycle</p>
          <div className="flex flex-wrap items-center justify-center gap-2 font-mono text-[11px]">
            <LoopStep label="Signal" icon="📡" active={true} />
            <Arrow />
            <LoopStep label="Job Created" icon="📋" active={summary ? summary.jobs > 0 : false} />
            <Arrow />
            <LoopStep label="Funded" icon="💰" active={summary ? summary.fundedJobs > 0 : false} />
            <Arrow />
            <LoopStep label="Delivered" icon="📦" active={recentJobs.some(j => j.status >= 3)} />
            <Arrow />
            <LoopStep label="Settled" icon="✅" active={summary ? summary.settledJobs > 0 : false} />
            <Arrow />
            <LoopStep label="Proof NFT" icon="🏆" active={summary ? summary.proofs > 0 : false} />
            <Arrow />
            <LoopStep label="Reputation" icon="⭐" active={true} />
          </div>
        </div>

        {/* ─── Recent Proofs ─────────────────────────────────────────── */}
        {overview && overview.proofs.length > 0 && (
          <div className="mt-6 rounded border border-white/5 bg-white/[0.02] p-4">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[#555]">Recent Settlement Proofs</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {overview.proofs.slice(0, 6).map(proof => (
                <div key={proof.tokenId} className="rounded border border-white/5 bg-black/30 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-[#C5A67C]">Proof #{proof.tokenId}</span>
                    <span className="font-mono text-[10px] text-[#555]">{timeAgo(proof.mintedAt)}</span>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-[#7A7A7A]">
                    Job #{proof.jobId} · {formatUSDC(proof.amountPaid)} USDC
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-[#444]">
                    Payer: {short(proof.payer)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-10 border-t border-white/5 pt-4 font-mono text-[10px] text-[#333]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>ArcLayer Protocol · Autonomous Agent Economy on Arc Network</span>
            <span>Data: on-chain indexer · No simulated values</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

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

function AgentCard({ agent }: { agent: Agent }) {
  const name = agent.metadataURI.includes('agent/')
    ? agent.metadataURI.split('agent/')[1]?.split('?')[0] || short(agent.agentId)
    : short(agent.agentId);

  return (
    <div className="rounded border border-white/5 bg-black/30 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-[#EAE4D8] capitalize">{name}</span>
        <span className="font-mono text-[10px] text-[#555]">{agent.jobs.length} jobs</span>
      </div>
      <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-[#7A7A7A]">
        <span>{agent.proofTokenIds.length} proofs</span>
        <span>·</span>
        <span>Score: {Number(agent.score) > 0 ? formatUSDC(agent.score) : '0'}</span>
      </div>
      <p className="mt-1 font-mono text-[9px] text-[#333]">{short(agent.controller)}</p>
    </div>
  );
}

function LoopStep({ label, icon, active }: { label: string; icon: string; active: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 rounded border px-3 py-2 transition-all ${active ? 'border-[#C5A67C]/40 bg-[#C5A67C]/5 text-[#EAE4D8]' : 'border-white/5 text-[#444]'}`}>
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function Arrow() {
  return <span className="text-[#333] text-lg">→</span>;
}
