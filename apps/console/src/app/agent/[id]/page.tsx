'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatUSDC, shortenAddress } from '@/lib/contracts';

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

type IndexedProof = {
  tokenId: string;
  jobId: string;
  agentId: string;
  payer: string;
  amountPaid: string;
  mintedAt: string;
  metadataURI: string;
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

type AgentDetail = {
  agent: IndexedAgent;
  jobs: IndexedJob[];
  proofs: IndexedProof[];
};

function parseAgentId(value: string | undefined) {
  return value && /^\d+$/.test(value) ? value : null;
}

function buildReputationSeries(agent: IndexedAgent | undefined, jobs: IndexedJob[], proofs: IndexedProof[]) {
  const baseScore = Number(agent?.score ?? 0);
  const reputation = Number(agent?.reputationScore ?? baseScore);
  const completedJobs = jobs.filter((job) => job.approved || job.status >= 3).length;
  const proofBoost = proofs.length * 2;
  const seed = Math.max(0, reputation - completedJobs - proofBoost);
  return [seed, seed + Math.ceil(completedJobs / 2), seed + completedJobs, Math.max(baseScore, reputation) + proofBoost];
}

function Sparkline({ values }: { values: number[] }) {
  const safeValues = values.length > 1 ? values : [0, 0];
  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);
  const range = max - min || 1;
  const points = safeValues
    .map((value, index) => {
      const x = (index / (safeValues.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 100 100" className="h-16 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" className="text-cyan-300" />
    </svg>
  );
}

export default function AgentProfilePage() {
  const params = useParams<{ id: string }>();
  const agentId = parseAgentId(params.id);
  const [profile, setProfile] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!agentId) {
        setError('Invalid agent id.');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(`${INDEXER_BASE_URL}/agents/${agentId}`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(response.status === 404 ? 'Agent not found.' : `Indexer returned HTTP ${response.status}.`);
        }

        const nextProfile = (await response.json()) as AgentDetail;
        if (!cancelled) {
          setProfile(nextProfile);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Failed to load agent profile.');
          setProfile(null);
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
  }, [agentId]);

  const agent = profile?.agent;
  const jobs = profile?.jobs || [];
  const proofs = profile?.proofs || [];
  const reputationSeries = buildReputationSeries(agent, jobs, proofs);

  return (
    <div className="relative px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/dashboard" className="text-sm font-semibold text-cyan-200">
              Back to dashboard
            </Link>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-white/35">Agent Registry</p>
            <h1 className="mt-3 font-[var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] md:text-[52px]">
              Agent #{agentId || '0'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/50">
              Indexed capability profile and work-proof history sourced from the ArcLayer protocol indexer.
            </p>
          </div>
          <Link href="/docs" className="btn-primary self-start md:self-auto">
            SDK Quickstart
          </Link>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Registry record</p>
            <div className="mt-5 space-y-3">
              {[
                ['Controller', agent ? shortenAddress(agent.controller) : isLoading ? 'Loading' : 'Unavailable'],
                ['Skill hash', agent ? `${agent.skillHash.slice(0, 10)}...${agent.skillHash.slice(-8)}` : isLoading ? 'Loading' : 'Unavailable'],
                ['Metadata', agent?.metadataURI || (isLoading ? 'Loading' : 'Unavailable')],
                ['Registered', agent ? new Date(Number(agent.registeredAt) * 1000).toLocaleString() : isLoading ? 'Loading' : 'Unavailable'],
              ].map(([label, value]) => (
                <div key={label} className="ledger-row flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                  <span className="text-sm text-white/45">{label}</span>
                  <span className="max-w-[60%] truncate text-right font-mono text-sm text-white/75">{value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Protocol telemetry</p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ['Score', agent ? agent.score : isLoading ? 'Loading' : '0'],
                ['Jobs', String(jobs.length)],
                ['Proofs', String(proofs.length)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-white/35">{label}</p>
                  <p className="mt-3 font-mono text-lg text-white/80">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-lg border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-white/35">Reputation trend</p>
              <div className="mt-3 text-cyan-200">
                <Sparkline values={reputationSeries} />
              </div>
              <p className="mt-2 text-sm leading-7 text-white/45">
                Reputation is projected from `ReputationOracle` and tied to payment-coupled work proofs.
              </p>
            </div>
          </section>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Jobs</p>
            <div className="mt-5 space-y-3">
              {jobs.length > 0 ? (
                jobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/job/${job.id}`}
                    className="block rounded-lg border border-white/10 bg-black/20 px-4 py-3 transition hover:border-cyan-300/30"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-sm text-white/80">Job #{job.id}</span>
                      <span className="font-mono text-xs text-cyan-200">{formatUSDC(BigInt(job.budget))} USDC</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 text-xs text-white/45">
                      <span>Worker {shortenAddress(job.worker)}</span>
                      <span>Status {job.status}</span>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/45">
                  {isLoading ? 'Loading jobs...' : 'No jobs found for this agent yet.'}
                </p>
              )}
            </div>
          </section>

          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Work proofs</p>
            <div className="mt-5 space-y-3">
              {proofs.length > 0 ? (
                proofs.map((proof) => (
                  <div key={proof.tokenId} className="rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-sm text-white/80">Job #{proof.jobId}</span>
                      <span className="font-mono text-xs text-cyan-200">{formatUSDC(BigInt(proof.amountPaid))} USDC</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 text-xs text-white/45">
                      <span>Payer {shortenAddress(proof.payer)}</span>
                      <span>{new Date(Number(proof.mintedAt) * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/45">
                  {isLoading ? 'Loading proofs...' : 'No work proofs minted for this agent yet.'}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
