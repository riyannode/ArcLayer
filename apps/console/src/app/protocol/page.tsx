'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { formatUSDC, shortenAddress } from '@/lib/contracts';
import { fetchIndexerJson, type DashboardOverview } from '@/lib/indexer';

const JOB_STATUS = ['Created', 'Budgeted', 'Funded', 'Submitted', 'Evaluated', 'Settled', 'Cancelled'] as const;
const JOB_TONE: Record<number, string> = { 0: '', 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'active', 6: 'error' };

const RPC_ENDPOINTS = [
  { label: 'rpc.testnet.arc.network', url: 'https://rpc.testnet.arc.network' },
  { label: 'blockdaemon', url: 'https://rpc.blockdaemon.testnet.arc.network' },
  { label: 'drpc', url: 'https://rpc.drpc.testnet.arc.network' },
  { label: 'quicknode', url: 'https://rpc.quicknode.testnet.arc.network' },
];

const ARC_EXPLORER = 'https://explorer.testnet.arc.network';

function copyToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }
}

type RpcHealth = { label: string; latency: number | null; blockNumber: bigint | null; ok: boolean };
type JobEvent = {
  eventName: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: number;
  jobId?: string;
  agentId?: string;
  worker?: string;
  client?: string;
  payout?: string;
  fee?: string;
  budget?: string;
};

async function probeRpc(url: string): Promise<{ blockNumber: bigint | null; latency: number }> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      cache: 'no-store',
    });
    const latency = performance.now() - t0;
    if (!res.ok) return { blockNumber: null, latency };
    const data = await res.json();
    return { blockNumber: data.result ? BigInt(data.result) : null, latency };
  } catch {
    return { blockNumber: null, latency: performance.now() - t0 };
  }
}

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [rpcHealth, setRpcHealth] = useState<RpcHealth[]>([]);
  const [chainHead, setChainHead] = useState<bigint | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [lastSyncedBlock, setLastSyncedBlock] = useState<bigint | null>(null);
  const [tickCount, setTickCount] = useState(0);
  const pulseRef = useRef<HTMLSpanElement>(null);

  async function loadOverview(options?: { silent?: boolean }) {
    try {
      if (options?.silent) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      const [next, eventsRes, rootRes] = await Promise.all([
        fetchIndexerJson<DashboardOverview>('/overview'),
        fetchIndexerJson<JobEvent[]>('/job-events').catch(() => [] as JobEvent[]),
        fetchIndexerJson<{ lastSyncedBlock?: string; eventCount?: number }>('/').catch(() => ({} as { lastSyncedBlock?: string })),
      ]);
      setOverview(next);
      setEvents(Array.isArray(eventsRes) ? eventsRes.slice(0, 20) : []);
      if (rootRes?.lastSyncedBlock) setLastSyncedBlock(BigInt(rootRes.lastSyncedBlock));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load protocol dashboard.');
      if (!options?.silent) setOverview(null);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setTickCount((t) => t + 1);
      if (pulseRef.current) {
        pulseRef.current.classList.remove('pulse-once');
        void pulseRef.current.offsetWidth;
        pulseRef.current.classList.add('pulse-once');
      }
    }
  }

  async function probeAllRpcs() {
    const results = await Promise.all(
      RPC_ENDPOINTS.map(async (ep) => {
        const { blockNumber, latency } = await probeRpc(ep.url);
        return { label: ep.label, latency, blockNumber, ok: blockNumber !== null };
      })
    );
    setRpcHealth(results);
    const heads = results.map((r) => r.blockNumber).filter((b): b is bigint => b !== null);
    if (heads.length > 0) setChainHead(heads.reduce((a, b) => (a > b ? a : b)));
  }

  useEffect(() => {
    loadOverview();
    probeAllRpcs();
    const indexerTick = window.setInterval(() => loadOverview({ silent: true }), 10000);
    const rpcTick = window.setInterval(() => probeAllRpcs(), 15000);
    return () => {
      window.clearInterval(indexerTick);
      window.clearInterval(rpcTick);
    };
  }, []);

  const jobs = overview?.jobs || [];
  const agents = overview?.agents || [];
  const summary = overview?.summary;
  // "lastSyncedBlock" here is block of last indexed event, not true cursor.
  // Report time-since-last-event as the real health signal.
  const blocksSinceLastEvent = chainHead && lastSyncedBlock ? Number(chainHead - lastSyncedBlock) : null;
  // Health: active protocol = events fire regularly. Dormant testnet = expected silence.
  // Testnet Arc ~2s block time → 1800 blocks/hr. Up to ~50k blocks (~28hrs) is normal for low-traffic testnet.
  const healthTone = blocksSinceLastEvent === null ? 'pending'
    : rpcHealth.every((r) => r.ok) ? 'active' : 'error';
  const healthLabel = blocksSinceLastEvent === null ? 'probing'
    : rpcHealth.every((r) => r.ok) ? 'healthy' : 'degraded';

  const fastestRpc = rpcHealth.length > 0 ? rpcHealth.reduce((a, b) => {
    if (!a.ok) return b;
    if (!b.ok) return a;
    return (a.latency ?? 9999) < (b.latency ?? 9999) ? a : b;
  }) : null;

  const topAgents = useMemo(() => [...agents].sort((a, b) => Number(BigInt(b.score) - BigInt(a.score))), [agents]);
  const connectedJobs = useMemo(() => {
    if (!address) return [];
    const lower = address.toLowerCase();
    return jobs.filter((j) => j.client.toLowerCase() === lower || j.worker.toLowerCase() === lower || j.evaluator.toLowerCase() === lower);
  }, [address, jobs]);

  return (
    <div className="relative px-6 py-16 md:px-10 md:py-24">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="aureo-mono-label mb-3" style={{ color: '#C5A67C' }}>PROTOCOL · TELEMETRY</div>
            <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[60px]" style={{ lineHeight: 0.95 }}>
              Protocol <span className="italic" style={{ color: '#C5A67C' }}>console</span>
            </h1>
            <p className="mt-4 max-w-xl font-mono text-[12px] leading-6" style={{ color: 'rgba(234, 228, 216, 0.6)' }}>
              {isConnected && address ? <><span style={{ color: '#C5A67C' }}>{shortenAddress(address)}</span> · </> : ''}
              Arc Testnet 5042002 · live indexer projections · RPC health · event tail
            </p>
          </div>
          <div className="flex items-center gap-3 self-start md:self-auto">
            <div className="flex items-center gap-2 rounded-sm border border-white/10 bg-black/40 px-3 py-2">
              <span
                ref={pulseRef}
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: error ? '#e68282' : '#B8CD7E', boxShadow: `0 0 8px ${error ? '#e68282' : '#B8CD7E'}` }}
              />
              <span className="font-mono text-[10.5px] uppercase tracking-[0.2em]" style={{ color: 'rgba(234, 228, 216, 0.7)' }}>
                {error ? 'offline' : isRefreshing ? 'syncing' : 'live'} · tick {tickCount}
              </span>
            </div>
            <button onClick={() => { loadOverview({ silent: true }); probeAllRpcs(); }} className="btn-bordered">
              {isRefreshing ? 'SYNCING…' : 'REFRESH'}
            </button>
            <Link href="/docs" className="btn-primary hidden md:inline-flex">SDK DOCS</Link>
          </div>
        </div>

        {/* Telemetry bar: RPC + indexer */}
        <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_1fr]">
          <Panel title="RPC · HEALTH" sub={`${RPC_ENDPOINTS.length} endpoints`}>
            <div className="space-y-2">
              {rpcHealth.length === 0
                ? RPC_ENDPOINTS.map((ep) => <RpcRow key={ep.label} label={ep.label} latency={null} blockNumber={null} ok={false} loading url={ep.url} />)
                : rpcHealth.map((r) => {
                    const ep = RPC_ENDPOINTS.find((e) => e.label === r.label);
                    return <RpcRow key={r.label} {...r} url={ep?.url} />;
                  })}
            </div>
          </Panel>
          <Panel title="PROTOCOL · HEALTH" sub={fastestRpc ? `fastest rpc: ${fastestRpc.label} (${fastestRpc.latency?.toFixed(0)}ms)` : 'probing rpcs'}>
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px]" style={{ color: 'rgba(234, 228, 216, 0.55)' }}>STATUS</span>
                <span className={`chip-status ${healthTone}`}>{healthLabel}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px]" style={{ color: 'rgba(234, 228, 216, 0.55)' }}>CHAIN HEAD</span>
                <span className="font-mono text-[11.5px]" style={{ color: '#C5A67C' }}>{chainHead ? `#${chainHead.toString()}` : '—'}</span>
              </div>
              <div className="flex items-baseline justify-between" title="Block of last indexed protocol event. Testnet is low-traffic — silence between events is expected.">
                <span className="font-mono text-[11px]" style={{ color: 'rgba(234, 228, 216, 0.55)' }}>LAST EVENT</span>
                <span className="font-mono text-[11.5px]" style={{ color: '#EAE4D8' }}>
                  {lastSyncedBlock ? `#${lastSyncedBlock.toString()}` : '—'}
                  {blocksSinceLastEvent !== null && <span className="ml-2" style={{ color: 'rgba(234, 228, 216, 0.4)' }}>(−{blocksSinceLastEvent.toLocaleString()} blk)</span>}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px]" style={{ color: 'rgba(234, 228, 216, 0.55)' }}>EVENTS INDEXED</span>
                <span className="font-mono text-[11.5px]" style={{ color: '#EAE4D8' }}>{summary?.eventCount ?? '—'}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px]" style={{ color: 'rgba(234, 228, 216, 0.55)' }}>CADENCE</span>
                <span className="font-mono text-[11.5px]" style={{ color: '#EAE4D8' }}>indexer 10s · rpc 15s</span>
              </div>
            </div>
          </Panel>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {[
            { k: 'JOBS', v: isLoading ? '…' : String(summary?.jobs ?? 0) },
            { k: 'AGENTS', v: isLoading ? '…' : String(summary?.agents ?? 0) },
            { k: 'BUDGETED · USDC', v: isLoading || !summary ? '…' : formatUSDC(BigInt(summary.totalBudget)) },
            { k: 'FUNDED · USDC', v: isLoading || !summary ? '…' : formatUSDC(BigInt(summary.totalFunded)) },
          ].map((s, i) => (
            <div
              key={s.k}
              className="flex flex-col gap-3 p-5"
              style={{
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'rgba(10, 10, 10, 0.6)',
                animation: `fadeInUp 0.4s ${i * 0.05}s both cubic-bezier(0.16, 1, 0.3, 1)`,
              }}
            >
              <span className="aureo-mono-label">{s.k}</span>
              <span className="aureo-display text-[34px] text-[#EAE4D8] md:text-[42px]" style={{ lineHeight: 1 }}>{s.v}</span>
              <span className="h-px w-8 bg-[#C5A67C]/50" />
            </div>
          ))}
        </div>

        {/* Main grid: jobs + event tail */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Panel title="JOB · LEDGER" sub={`${jobs.length} indexed`} action={<Link href="/jobs" className="font-mono text-[11px]" style={{ color: '#C5A67C' }}>OPEN ALL ↗</Link>}>
            <div className="mb-3 hidden grid-cols-[40px_1fr_70px_80px_90px] items-center gap-3 border-b border-white/5 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] md:grid" style={{ color: 'rgba(234, 228, 216, 0.4)' }}>
              <span>ID</span><span>CLIENT → WORKER</span><span className="text-right">AGENT</span><span className="text-right">USDC</span><span className="text-right">STATE</span>
            </div>
            <div className="space-y-2">
              {jobs.length === 0 ? <Empty msg={isLoading ? 'Loading jobs…' : 'No jobs indexed yet.'} /> : jobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/job/${job.id.toString()}`}
                  className="ledger-row block border border-white/10 bg-black/20 px-4 py-3 hover:border-[#C5A67C]/40"
                >
                  <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[40px_1fr_70px_80px_90px] md:gap-3">
                    <span className="font-mono text-[12.5px]" style={{ color: '#EAE4D8' }}>#{job.id}</span>
                    <span className="font-mono text-[11px]" style={{ color: 'rgba(234, 228, 216, 0.7)' }}>
                      {shortenAddress(job.client)} <span style={{ color: '#C5A67C' }}>→</span> {shortenAddress(job.worker)}
                    </span>
                    <span className="text-left font-mono text-[10.5px] md:text-right" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>ag #{job.agentId}</span>
                    <span className="text-left font-mono text-[11px] md:text-right" style={{ color: '#C5A67C' }}>{formatUSDC(BigInt(job.budget))}</span>
                    <span className={`chip-status ${JOB_TONE[job.status] || 'pending'} justify-self-start md:justify-self-end`}>{JOB_STATUS[job.status]}</span>
                  </div>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel title="EVENT · TAIL" sub={`${events.length} recent`}>
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {events.length === 0 ? <Empty msg={isLoading ? 'Loading events…' : 'No events yet.'} /> : events.map((ev) => (
                <div
                  key={`${ev.transactionHash}-${ev.logIndex}`}
                  className="border border-white/5 bg-black/30 px-3 py-2 transition hover:border-[#C5A67C]/30"
                  style={{ animation: 'fadeInUp 0.4s both cubic-bezier(0.16, 1, 0.3, 1)' }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[11.5px] font-medium" style={{ color: eventColor(ev.eventName) }}>{ev.eventName}</span>
                    <a
                      href={`${ARC_EXPLORER}/block/${ev.blockNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] hover:text-[#C5A67C]"
                      style={{ color: 'rgba(234, 228, 216, 0.45)' }}
                    >
                      #{ev.blockNumber.slice(-6)}
                    </a>
                  </div>
                  <div className="mt-1 font-mono text-[10.5px]" style={{ color: 'rgba(234, 228, 216, 0.65)' }}>
                    {ev.jobId && <Link href={`/job/${ev.jobId}`} className="hover:text-[#C5A67C]">job <span style={{ color: '#EAE4D8' }}>#{ev.jobId}</span></Link>}
                    {ev.jobId && ev.agentId && ' · '}
                    {ev.agentId && <Link href={`/agent/${ev.agentId}`} className="hover:text-[#C5A67C]">agent <span style={{ color: '#EAE4D8' }}>#{ev.agentId}</span></Link>}
                    {(ev.payout || ev.budget) && ' · '}
                    {ev.payout && <>payout <span style={{ color: '#C5A67C' }}>{formatUSDC(BigInt(ev.payout))}</span></>}
                    {ev.budget && !ev.payout && <>budget <span style={{ color: '#C5A67C' }}>{formatUSDC(BigInt(ev.budget))}</span></>}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <a
                      href={`${ARC_EXPLORER}/tx/${ev.transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[9.5px] truncate hover:text-[#C5A67C]"
                      style={{ color: 'rgba(234, 228, 216, 0.35)' }}
                    >
                      {ev.transactionHash.slice(0, 10)}…{ev.transactionHash.slice(-6)} ↗
                    </a>
                    <button
                      onClick={() => copyToClipboard(ev.transactionHash)}
                      className="font-mono text-[9px] uppercase tracking-wider hover:text-[#C5A67C]"
                      style={{ color: 'rgba(234, 228, 216, 0.3)' }}
                      title="copy tx hash"
                    >
                      copy
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Agent leaderboard */}
        <div className="mt-8">
          <Panel title="AGENT · LEADERBOARD" sub={`${topAgents.length} registered`} action={<Link href="/agents" className="font-mono text-[11px]" style={{ color: '#C5A67C' }}>OPEN ALL ↗</Link>}>
            <div className="mb-3 hidden grid-cols-[40px_1fr_80px_80px_80px] items-center gap-3 border-b border-white/5 pb-2 font-mono text-[10px] uppercase tracking-[0.2em] md:grid" style={{ color: 'rgba(234, 228, 216, 0.4)' }}>
              <span>ID</span><span>CONTROLLER</span><span className="text-right">SCORE</span><span className="text-right">JOBS</span><span className="text-right">PROOFS</span>
            </div>
            <div className="space-y-2">
              {topAgents.length === 0 ? <Empty msg="No agents registered." /> : topAgents.map((a) => (
                <Link
                  key={a.agentId}
                  href={`/agent/${a.agentId}`}
                  className="ledger-row block border border-white/10 bg-black/20 px-4 py-3 hover:border-[#C5A67C]/40"
                >
                  <div className="grid grid-cols-1 items-center gap-2 md:grid-cols-[40px_1fr_80px_80px_80px] md:gap-3">
                    <span className="font-mono text-[12.5px]" style={{ color: '#EAE4D8' }}>#{a.agentId}</span>
                    <span className="font-mono text-[11px]" style={{ color: 'rgba(234, 228, 216, 0.7)' }}>{shortenAddress(a.controller)}</span>
                    <span className="text-left font-mono text-[11px] md:text-right" style={{ color: '#C5A67C' }}>{a.score}</span>
                    <span className="text-left font-mono text-[11px] md:text-right" style={{ color: 'rgba(234, 228, 216, 0.7)' }}>{a.jobs.length}</span>
                    <span className="text-left font-mono text-[11px] md:text-right" style={{ color: 'rgba(234, 228, 216, 0.7)' }}>{a.proofTokenIds.length}</span>
                  </div>
                </Link>
              ))}
            </div>
          </Panel>
        </div>

        {/* Wallet view */}
        {isConnected && address && (
          <div className="mt-8">
            <Panel title="WALLET · PARTICIPATION" sub={`${connectedJobs.length} as client/worker/evaluator`}>
              {connectedJobs.length === 0 ? (
                <Empty msg="No JobEscrow records found for this wallet yet." />
              ) : (
                <div className="space-y-2">
                  {connectedJobs.map((job) => (
                    <Link
                      href={`/job/${job.id}`}
                      key={`conn-${job.id}`}
                      className="ledger-row block border border-white/10 bg-black/20 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-mono text-[12.5px]" style={{ color: '#EAE4D8' }}>Job #{job.id}</span>
                        <span className={`chip-status ${JOB_TONE[job.status] || 'pending'}`}>{JOB_STATUS[job.status]}</span>
                      </div>
                      <div className="mt-1 font-mono text-[10.5px]" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>
                        client {shortenAddress(job.client)} · worker {shortenAddress(job.worker)}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        )}

        {error && (
          <div className="mt-8 p-5" style={{ border: '1px solid rgba(230, 130, 130, 0.35)', background: 'rgba(230, 130, 130, 0.06)' }}>
            <div className="aureo-mono-label" style={{ color: '#e68282' }}>INDEXER · UNREACHABLE</div>
            <p className="mt-2 font-mono text-[11.5px] leading-5" style={{ color: '#f0c5c5' }}>
              {error} · start with <span style={{ color: '#C5A67C' }}>pnpm --dir indexer start</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function eventColor(name: string): string {
  if (name.includes('Settled')) return '#B8CD7E';
  if (name.includes('Cancel')) return '#e68282';
  if (name.includes('Fund') || name.includes('Created')) return '#C5A67C';
  return '#EAE4D8';
}

function Panel({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="p-5 md:p-6" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.6)' }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="aureo-mono-label" style={{ color: 'rgba(234, 228, 216, 0.5)' }}>{title}</div>
          {sub && <div className="mt-1 font-mono text-[10.5px]" style={{ color: 'rgba(234, 228, 216, 0.35)' }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function RpcRow({ label, latency, blockNumber, ok, loading, url }: RpcHealth & { loading?: boolean; url?: string }) {
  const tone = loading ? 'pending' : ok ? 'active' : 'error';
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-white/5 bg-black/30 px-3 py-2 transition hover:border-[#C5A67C]/30">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: loading ? '#C5A67C' : ok ? '#B8CD7E' : '#e68282', boxShadow: `0 0 6px ${loading ? '#C5A67C' : ok ? '#B8CD7E' : '#e68282'}` }}
        />
        <span className="truncate font-mono text-[11px]" style={{ color: 'rgba(234, 228, 216, 0.85)' }}>{label}</span>
        {url && (
          <button
            onClick={() => copyToClipboard(url)}
            className="font-mono text-[9px] uppercase tracking-wider hover:text-[#C5A67C]"
            style={{ color: 'rgba(234, 228, 216, 0.3)' }}
            title="copy rpc url"
          >
            copy
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 font-mono text-[10.5px]">
        <span style={{ color: latency && latency < 100 ? '#B8CD7E' : 'rgba(234, 228, 216, 0.5)' }}>{latency === null ? '—' : `${latency.toFixed(0)}ms`}</span>
        <span style={{ color: 'rgba(234, 228, 216, 0.5)' }}>{blockNumber ? `#${blockNumber.toString().slice(-6)}` : '—'}</span>
        <span className={`chip-status ${tone}`}>{loading ? 'probe' : ok ? 'ok' : 'down'}</span>
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <p className="p-4 font-mono text-[11.5px] leading-5" style={{ color: 'rgba(234, 228, 216, 0.45)', border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0, 0, 0, 0.25)' }}>
      {msg}
    </p>
  );
}
