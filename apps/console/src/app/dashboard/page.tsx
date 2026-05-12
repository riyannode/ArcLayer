'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { formatUSDC, shortenAddress } from '@/lib/contracts';

const JOB_STATUS = ['Created', 'Budgeted', 'Funded', 'Submitted', 'Evaluated', 'Settled', 'Cancelled'] as const;
const INDEXER_BASE_URL = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4307';

type IndexedJob = {
  id: string;
  agentId: string;
  client: string;
  worker: string;
  evaluator: string;
  budget: string;
  fundedAmount: string;
  createdAt: string;
  jobSpecHash: string;
  deliverableURI: string;
  proofMetadataURI: string;
  approved: boolean;
  status: number;
};

type IndexedAgent = {
  agentId: string;
  controller: string;
  skillHash: string;
  metadataURI: string;
  registeredAt: string;
  reputationScore: string;
  score: string;
  jobs: string[];
  proofTokenIds: string[];
};

type DashboardOverview = {
  summary: {
    eventCount: number;
    jobs: number;
    agents: number;
    proofs: number;
    totalBudget: string;
    totalFunded: string;
    settledJobs: number;
    fundedJobs: number;
  };
  jobs: IndexedJob[];
  agents: IndexedAgent[];
  proofs: {
    tokenId: string;
    jobId: string;
    agentId: string;
    payer: string;
    amountPaid: string;
    mintedAt: string;
    metadataURI: string;
  }[];
};

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch(`${INDEXER_BASE_URL}/overview`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Indexer returned HTTP ${response.status}.`);
        }
        const nextOverview = (await response.json()) as DashboardOverview;

        if (!cancelled) {
          setOverview(nextOverview);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : 'Failed to load protocol dashboard from the indexer.'
          );
          setOverview(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const jobs = overview?.jobs || [];
  const agents = overview?.agents || [];
  const summary = overview?.summary;

  const settledJobs = useMemo(() => jobs.filter((job) => job.status === 5), [jobs]);
  const fundedJobs = useMemo(() => jobs.filter((job) => BigInt(job.fundedAmount) > BigInt(0)), [jobs]);

  const connectedJobs = useMemo(() => {
    if (!address) return [];
    const lower = address.toLowerCase();
    return jobs.filter(
      (job) =>
        job.client.toLowerCase() === lower ||
        job.worker.toLowerCase() === lower ||
        job.evaluator.toLowerCase() === lower
    );
  }, [address, jobs]);

  const topAgents = useMemo(() => [...agents].sort((a, b) => Number(BigInt(b.score) - BigInt(a.score))).slice(0, 6), [agents]);

  return (
    <div className="relative px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 text-xs font-light uppercase tracking-[0.24em] text-cyan-300/70">
              Protocol dashboard
            </p>
            <h1 className="text-[36px] font-light leading-tight md:text-[52px]">
              JobEscrow and AgentRegistry overview
            </h1>
            <p className="mt-3 text-sm font-light text-white/45">
              {isConnected && address ? `${shortenAddress(address)} · ` : ''}Arc Testnet protocol telemetry
            </p>
          </div>
          <Link href="/docs" className="btn-primary self-start md:self-auto">
            SDK Quickstart
          </Link>
        </div>

        {error && (
          <div className="mb-8 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-5">
            <p className="text-sm font-light text-amber-100">
              {error} Start the indexer with <span className="font-mono">corepack pnpm --dir indexer start</span>.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
          <div className="glass-card p-6">
            <p className="text-xs font-light uppercase tracking-[0.2em] text-white/35">Jobs</p>
            <p className="mt-4 text-4xl font-light">{isLoading ? '...' : summary?.jobs ?? 0}</p>
          </div>
          <div className="glass-card p-6">
            <p className="text-xs font-light uppercase tracking-[0.2em] text-white/35">Agents</p>
            <p className="mt-4 text-4xl font-light">{isLoading ? '...' : summary?.agents ?? 0}</p>
          </div>
          <div className="glass-card p-6">
            <p className="text-xs font-light uppercase tracking-[0.2em] text-white/35">Budgeted</p>
            <p className="mt-4 text-4xl font-light">{isLoading || !summary ? '...' : formatUSDC(BigInt(summary.totalBudget))}</p>
          </div>
          <div className="glass-card p-6">
            <p className="text-xs font-light uppercase tracking-[0.2em] text-white/35">Funded</p>
            <p className="mt-4 text-4xl font-light">{isLoading || !summary ? '...' : formatUSDC(BigInt(summary.totalFunded))}</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="glass-card p-6">
            <h2 className="text-lg font-light">Live jobs</h2>
            <div className="mt-5 space-y-3">
              {jobs.length > 0 ? (
                jobs.map((job) => (
                  <Link
                    href={`/job/${job.id.toString()}`}
                    key={job.id}
                    className="block rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-cyan-300/30"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="truncate text-sm font-semibold text-white">Job #{job.id}</span>
                      <span className="font-mono text-xs text-cyan-200">{formatUSDC(BigInt(job.budget))} USDC</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 text-xs text-white/45">
                      <span>Agent #{job.agentId}</span>
                      <span>{JOB_STATUS[job.status]}</span>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm font-light leading-7 text-white/45">
                  {isLoading ? 'Loading jobs...' : 'No protocol jobs found yet.'}
                </p>
              )}
            </div>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-lg font-light">Top agents</h2>
            <div className="mt-5 space-y-3">
              {topAgents.length > 0 ? (
                topAgents.map((profile) => (
                  <Link
                    href={`/agent/${profile.agentId}`}
                    key={profile.agentId}
                    className="block rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-cyan-300/30"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="truncate text-sm font-semibold text-white">Agent #{profile.agentId}</span>
                      <span className="font-mono text-xs text-cyan-200">Score {profile.score}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 text-xs text-white/45">
                      <span>{shortenAddress(profile.controller)}</span>
                      <span>{profile.jobs.length} jobs</span>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm font-light leading-7 text-white/45">
                  {isLoading ? 'Loading agents...' : 'No registered agents were discovered from active jobs.'}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="glass-card p-6">
            <h2 className="text-lg font-light">Protocol flow</h2>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                { label: 'Created', body: 'Client created a job and assigned an agent identity.' },
                { label: 'Funded', body: 'Escrow received USDC against the job budget.' },
                { label: 'Evaluated', body: 'Evaluator marked the deliverable as approved or rejected.' },
                { label: 'Settled', body: 'Worker was paid and WorkProof could be minted.' },
              ].map((state) => (
                <div key={state.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-sm font-medium text-white">{state.label}</p>
                  <p className="mt-2 text-sm font-light leading-6 text-white/45">{state.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-lg font-light">Connected wallet view</h2>
            <div className="mt-5 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/70">Protocol participation</p>
              <p className="mt-2 font-mono text-sm text-white/75">
                {isConnected && address ? `${connectedJobs.length} matching jobs` : 'Connect wallet to filter jobs'}
              </p>
            </div>
            <div className="mt-5 space-y-3">
              {isConnected && address ? (
                connectedJobs.length > 0 ? (
                  connectedJobs.map((job) => (
                    <Link
                      href={`/job/${job.id}`}
                      key={`connected-${job.id}`}
                      className="block rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-cyan-300/30"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm font-semibold text-white">Job #{job.id}</span>
                        <span className="font-mono text-xs text-cyan-200">{JOB_STATUS[job.status]}</span>
                      </div>
                      <div className="mt-2 text-xs text-white/45">
                        Client {shortenAddress(job.client)} · Worker {shortenAddress(job.worker)}
                      </div>
                    </Link>
                  ))
                ) : (
                  <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm font-light leading-7 text-white/45">
                    No `JobEscrow` records found for this wallet yet.
                  </p>
                )
              ) : (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm font-light leading-7 text-white/45">
                  Connect wallet from the navigation to filter the dashboard by client, worker, or evaluator address.
                </p>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-white/35">Settled jobs</p>
                <p className="mt-2 font-mono text-white/80">{summary?.settledJobs ?? settledJobs.length}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-white/35">Funded jobs</p>
                <p className="mt-2 font-mono text-white/80">{summary?.fundedJobs ?? fundedJobs.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
