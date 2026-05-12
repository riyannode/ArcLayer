'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { formatUSDC, shortenAddress } from '@/lib/contracts';
import { StatusBanner } from '@/components/StatusBanner';
import { fetchIndexerJson, type DashboardOverview } from '@/lib/indexer';

const JOB_STATUS = ['Created', 'Budgeted', 'Funded', 'Submitted', 'Evaluated', 'Settled', 'Cancelled'] as const;

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function loadOverview(options?: { silent?: boolean }) {
    try {
      if (options?.silent) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      const next = await fetchIndexerJson<DashboardOverview>('/overview');
      setOverview(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load protocol dashboard.');
      if (!options?.silent) setOverview(null);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    loadOverview();
    const id = window.setInterval(() => loadOverview({ silent: true }), 15000);
    return () => window.clearInterval(id);
  }, []);

  const jobs = overview?.jobs || [];
  const agents = overview?.agents || [];
  const summary = overview?.summary;

  const settledJobs = useMemo(() => jobs.filter((j) => j.status === 5), [jobs]);
  const fundedJobs = useMemo(() => jobs.filter((j) => BigInt(j.fundedAmount) > BigInt(0)), [jobs]);
  const connectedJobs = useMemo(() => {
    if (!address) return [];
    const lower = address.toLowerCase();
    return jobs.filter((j) => j.client.toLowerCase() === lower || j.worker.toLowerCase() === lower || j.evaluator.toLowerCase() === lower);
  }, [address, jobs]);
  const topAgents = useMemo(() => [...agents].sort((a, b) => Number(BigInt(b.score) - BigInt(a.score))).slice(0, 6), [agents]);

  return (
    <div className="relative px-6 py-16 md:px-10 md:py-24">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="aureo-mono-label mb-3">PROTOCOL · CONSOLE</div>
            <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
              JobEscrow &amp; <span className="italic text-[#C5A67C]">AgentRegistry</span>
            </h1>
            <p className="mt-3 max-w-xl font-mono text-[12px] leading-6 text-[#9a9a9a]">
              {isConnected && address ? <><span className="text-[#C5A67C]">{shortenAddress(address)}</span> · </> : ''}
              Arc Testnet · chain 5042002 · live protocol telemetry from @arclayer/indexer.
            </p>
          </div>
          <div className="flex gap-3 self-start md:self-auto">
            <button
              onClick={() => loadOverview({ silent: true })}
              className="btn-bordered"
            >
              {isRefreshing ? 'REFRESHING…' : 'REFRESH'}
            </button>
            <Link href="/docs" className="btn-primary">SDK QUICKSTART</Link>
          </div>
        </div>

        {error && (
          <div className="mb-8 p-5" style={{ border: '1px solid rgba(230, 130, 130, 0.35)', background: 'rgba(230, 130, 130, 0.06)' }}>
            <div className="aureo-mono-label" style={{ color: '#e68282' }}>INDEXER · UNREACHABLE</div>
            <p className="mt-2 font-mono text-[11.5px] leading-5 text-[#f0c5c5]">
              {error} &nbsp;·&nbsp; start with <span className="text-[#C5A67C]">pnpm --dir indexer start</span>
            </p>
          </div>
        )}

        {!error && (
          <div className="mb-8">
            <StatusBanner
              tone={isRefreshing ? 'pending' : 'synced'}
              title={isRefreshing ? 'INDEXER · REFRESHING' : 'INDEXER · SYNCED'}
              body={
                isRefreshing
                  ? 'Refreshing overview. Receipts may already be final on-chain while projections catch up.'
                  : `${summary?.eventCount ?? 0} indexed events · ${summary?.jobs ?? 0} jobs · ${summary?.agents ?? 0} agents.`
              }
            />
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { k: 'JOBS', v: isLoading ? '…' : String(summary?.jobs ?? 0) },
            { k: 'AGENTS', v: isLoading ? '…' : String(summary?.agents ?? 0) },
            { k: 'BUDGETED', v: isLoading || !summary ? '…' : `${formatUSDC(BigInt(summary.totalBudget))}` },
            { k: 'FUNDED', v: isLoading || !summary ? '…' : `${formatUSDC(BigInt(summary.totalFunded))}` },
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
              <span className="aureo-display text-[38px] text-[#EAE4D8] md:text-[46px]">{s.v}</span>
              <span className="h-px w-8 bg-[#C5A67C]/50" />
            </div>
          ))}
        </div>

        {/* Live jobs + top agents */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <ListPanel title="Live jobs" count={jobs.length}>
            {jobs.length > 0 ? (
              jobs.map((job) => (
                <Link
                  href={`/job/${job.id.toString()}`}
                  key={job.id}
                  className="ledger-row block border border-white/10 bg-black/20 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-[12.5px] text-[#EAE4D8]">Job #{job.id}</span>
                    <span className="font-mono text-[11px] text-[#C5A67C]">{formatUSDC(BigInt(job.budget))} USDC</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-4 font-mono text-[10.5px] text-[#7A7A7A]">
                    <span>Agent #{job.agentId}</span>
                    <span className="chip-status pending">{JOB_STATUS[job.status]}</span>
                  </div>
                </Link>
              ))
            ) : (
              <Empty msg={isLoading ? 'Loading jobs…' : 'No protocol jobs indexed yet.'} />
            )}
          </ListPanel>

          <ListPanel title="Top agents" count={topAgents.length}>
            {topAgents.length > 0 ? (
              topAgents.map((a) => (
                <Link
                  href={`/agent/${a.agentId}`}
                  key={a.agentId}
                  className="ledger-row block border border-white/10 bg-black/20 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-[12.5px] text-[#EAE4D8]">Agent #{a.agentId}</span>
                    <span className="font-mono text-[11px] text-[#C5A67C]">Score {a.score}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-4 font-mono text-[10.5px] text-[#7A7A7A]">
                    <span>{shortenAddress(a.controller)}</span>
                    <span>{a.jobs.length} jobs</span>
                  </div>
                </Link>
              ))
            ) : (
              <Empty msg={isLoading ? 'Loading agents…' : 'No registered agents from active jobs.'} />
            )}
          </ListPanel>
        </div>

        {/* Protocol flow + wallet view */}
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="p-6" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.6)' }}>
            <div className="aureo-mono-label mb-4">PROTOCOL · FLOW</div>
            <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Lifecycle</h2>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { l: 'Created', b: 'Client opens a job and assigns an agent identity.' },
                { l: 'Funded', b: 'Escrow receives USDC against the job budget.' },
                { l: 'Evaluated', b: 'Evaluator marks the deliverable approved or rejected.' },
                { l: 'Settled', b: 'Worker is paid; WorkProof becomes mintable.' },
              ].map((state, i) => (
                <div
                  key={state.l}
                  className="p-4"
                  style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0, 0, 0, 0.3)' }}
                >
                  <p className="font-mono text-[10px] tracking-[0.2em] text-[#C5A67C]">0{i + 1} · {state.l.toUpperCase()}</p>
                  <p className="mt-2 font-mono text-[11px] leading-5 text-[#9a9a9a]">{state.b}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="p-6" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.6)' }}>
            <div className="aureo-mono-label mb-4">WALLET · VIEW</div>
            <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Your jobs</h2>
            <div
              className="mt-5 p-4"
              style={{ border: '1px solid rgba(197, 166, 124, 0.25)', background: 'rgba(197, 166, 124, 0.06)' }}
            >
              <p className="aureo-mono-label" style={{ color: '#C5A67C' }}>PARTICIPATION</p>
              <p className="mt-2 font-mono text-[12px] text-[#EAE4D8]">
                {isConnected && address ? `${connectedJobs.length} matching job${connectedJobs.length === 1 ? '' : 's'}` : 'Connect wallet to filter jobs'}
              </p>
            </div>
            <div className="mt-5 space-y-3">
              {isConnected && address ? (
                connectedJobs.length > 0 ? (
                  connectedJobs.map((job) => (
                    <Link
                      href={`/job/${job.id}`}
                      key={`connected-${job.id}`}
                      className="ledger-row block border border-white/10 bg-black/20 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-mono text-[12.5px] text-[#EAE4D8]">Job #{job.id}</span>
                        <span className="chip-status pending">{JOB_STATUS[job.status]}</span>
                      </div>
                      <div className="mt-2 font-mono text-[10.5px] text-[#7A7A7A]">
                        client {shortenAddress(job.client)} · worker {shortenAddress(job.worker)}
                      </div>
                    </Link>
                  ))
                ) : (
                  <Empty msg="No JobEscrow records found for this wallet yet." />
                )
              ) : (
                <Empty msg="Connect wallet from the navigation to filter by client, worker, or evaluator." />
              )}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Stat l="SETTLED" v={`${summary?.settledJobs ?? settledJobs.length}`} />
              <Stat l="FUNDED" v={`${summary?.fundedJobs ?? fundedJobs.length}`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ListPanel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="p-6" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.6)' }}>
      <div className="flex items-center justify-between">
        <div>
          <div className="aureo-mono-label mb-2">LEDGER</div>
          <h2 className="aureo-display text-[28px] text-[#EAE4D8]">{title}</h2>
        </div>
        <span className="font-mono text-[11px] text-[#C5A67C]">{count} indexed</span>
      </div>
      <div className="mt-5 space-y-3">{children}</div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <p className="p-4 font-mono text-[11.5px] leading-5 text-[#7A7A7A]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0, 0, 0, 0.25)' }}>
      {msg}
    </p>
  );
}

function Stat({ l, v }: { l: string; v: string }) {
  return (
    <div className="p-4" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0, 0, 0, 0.3)' }}>
      <p className="aureo-mono-label">{l}</p>
      <p className="mt-1.5 font-mono text-[13px] text-[#EAE4D8]">{v}</p>
    </div>
  );
}
