'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readContract, waitForTransactionReceipt } from '@wagmi/core';
import { useAccount, useWriteContract } from 'wagmi';
import { CONTRACTS, JOB_ESCROW_ABI, buildApproveUsdcConfig, buildCreateJobConfig, buildFundJobConfig, buildSetBudgetConfig } from '@arclayer/sdk';
import { formatUSDC, shortenAddress } from '@/lib/contracts';
import { parseUSDC } from '@/lib/contracts';
import { config } from '@/lib/wagmi';

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

const JOB_STATUS = ['Created', 'Budgeted', 'Funded', 'Submitted', 'Evaluated', 'Settled', 'Cancelled'] as const;

function parseAgentId(value: string | undefined) {
  return value && /^\d+$/.test(value) ? value : null;
}

function buildReputationSeries(agent: IndexedAgent | undefined, jobs: IndexedJob[], proofs: IndexedProof[]) {
  const baseScore = Number(agent?.score ?? 0);
  const reputation = Number(agent?.reputationScore ?? baseScore);
  const completedJobs = jobs.filter((job) => job.approved || job.status >= 3).length;
  const proofBoost = proofs.length * 2;
  const seed = Math.max(0, reputation - completedJobs - proofBoost);
  return [
    seed,
    seed + Math.ceil(completedJobs / 2),
    seed + completedJobs,
    Math.max(baseScore, reputation) + proofBoost,
  ];
}

function Sparkline({ values }: { values: number[] }) {
  const safe = values.length > 1 ? values : [0, 0];
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const range = max - min || 1;
  const points = safe
    .map((v, i) => {
      const x = (i / (safe.length - 1)) * 100;
      const y = 100 - ((v - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg viewBox="0 0 100 100" className="h-20 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#C5A67C" stopOpacity="0.35" />
          <stop offset="1" stopColor="#C5A67C" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`0,100 ${points} 100,100`}
        fill="url(#sparkFill)"
        stroke="none"
      />
      <polyline
        points={points}
        fill="none"
        stroke="#C5A67C"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {safe.map((v, i) => {
        const x = (i / (safe.length - 1)) * 100;
        const y = 100 - ((v - min) / range) * 100;
        return <circle key={i} cx={x} cy={y} r="1.2" fill="#EAE4D8" />;
      })}
    </svg>
  );
}

export default function AgentProfilePage() {
  const params = useParams<{ id: string }>();
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const agentId = parseAgentId(params.id);
  const [profile, setProfile] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [runInput, setRunInput] = useState('Run a paid test task through x402.');
  const [runBudget, setRunBudget] = useState('1');
  const [runState, setRunState] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!agentId) { setError('Invalid agent id.'); setIsLoading(false); return; }
      try {
        setIsLoading(true); setError(null);
        const r = await fetch(`${INDEXER_BASE_URL}/agents/${agentId}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status === 404 ? 'Agent not found.' : `Indexer returned HTTP ${r.status}.`);
        const next = (await r.json()) as AgentDetail;
        if (!cancelled) setProfile(next);
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : 'Failed to load agent profile.'); setProfile(null); }
      } finally { if (!cancelled) setIsLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [agentId]);

  const agent = profile?.agent;
  const jobs = profile?.jobs || [];
  const proofs = profile?.proofs || [];
  const series = buildReputationSeries(agent, jobs, proofs);

  async function handlePaidRun() {
    if (!agent || !agentId || !address) return;
    try {
      setIsRunning(true);
      setRunState('POST /api/agents/:id/run -> 402 Payment Required');
      const first = await fetch(`/api/agents/${agentId}/run`, { method: 'POST', body: JSON.stringify({ input: runInput }) });
      if (first.status !== 402) throw new Error(`Expected x402 challenge, received HTTP ${first.status}.`);

      const amount = parseUSDC(runBudget);
      const nextJobId = (await readContract(config, {
        address: CONTRACTS.JOB_ESCROW,
        abi: JOB_ESCROW_ABI,
        functionName: 'jobCounter',
      }) as bigint) + BigInt(1);
      setRunState('Creating JobEscrow run for agent worker...');
      const createHash = await writeContractAsync(buildCreateJobConfig(BigInt(agentId), agent.controller as `0x${string}`, address, runInput));
      await waitForTransactionReceipt(config, { hash: createHash });

      setRunState('Setting budget and approving testnet USDC...');
      const visibleJobId = nextJobId;
      const budgetHash = await writeContractAsync(buildSetBudgetConfig(visibleJobId, amount));
      await waitForTransactionReceipt(config, { hash: budgetHash });
      const approveHash = await writeContractAsync(buildApproveUsdcConfig(amount));
      await waitForTransactionReceipt(config, { hash: approveHash });

      setRunState('Funding job and retrying x402 request with X-PAYMENT...');
      const fundHash = await writeContractAsync(buildFundJobConfig(visibleJobId, amount));
      await waitForTransactionReceipt(config, { hash: fundHash });
      const paid = await fetch(`/api/agents/${agentId}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-payment': JSON.stringify({ txHash: fundHash, chainId: 5042002 }) },
        body: JSON.stringify({ input: runInput, jobId: visibleJobId.toString() }),
      });
      const payload = await paid.json();
      if (!paid.ok) throw new Error(payload.message || payload.error || `Paid run failed with HTTP ${paid.status}.`);
      setRunState(`${payload.result.message} Job #${visibleJobId.toString()} funded.`);
    } catch (e) {
      setRunState(e instanceof Error ? e.message : 'Paid run failed.');
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="aureo-detail-hero mb-8 p-5 md:p-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/dashboard" className="font-mono text-[11px] tracking-[0.16em] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]">
              ← BACK · CONSOLE
            </Link>
            <div className="aureo-mono-label mt-5 mb-3">PROTOCOL · AGENT</div>
            <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
              Agent <span className="italic text-[#C5A67C]">#{agentId || '0'}</span>
            </h1>
            <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[#9a9a9a]">
              Indexed capability profile and work-proof history from the ArcLayer indexer.
            </p>
          </div>
          <Link href="/docs" className="btn-primary self-start md:self-auto">SDK QUICKSTART</Link>
        </div>

        <section className="mb-6 p-6" style={{ border: '1px solid rgba(197, 166, 124, 0.22)', background: 'rgba(10, 10, 10, 0.68)' }}>
          <div className="aureo-mono-label mb-2">X402 · BUYER RUN</div>
          <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Payment-required agent call</h2>
          <p className="mt-2 max-w-3xl font-mono text-[11.5px] leading-5 text-[#9a9a9a]">
            Calls <span className="text-[#C5A67C]">POST /api/agents/{agentId}/run</span>, receives a 402 challenge, registers a funded JobEscrow payment on Arc Testnet, then retries with X-PAYMENT.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_auto]">
            <input value={runInput} onChange={(e) => setRunInput(e.target.value)} className="input-mono" placeholder="buyer task / prompt" />
            <input value={runBudget} onChange={(e) => setRunBudget(e.target.value)} className="input-mono" placeholder="USDC" />
            <button onClick={handlePaidRun} disabled={!isConnected || !agent || isRunning} className="btn-primary">
              {isRunning ? 'RUNNING...' : 'PAY · RUN'}
            </button>
          </div>
          <div className="mt-4 p-4 font-mono text-[11.5px] leading-5 text-[#9a9a9a]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
            {runState || (isConnected ? 'Wallet connected. Needs testnet USDC for approval/funding.' : 'Connect a wallet on Arc Testnet 5042002 to test end-to-end.')}
          </div>
        </section>

        {error && (
          <div className="mb-6 p-4" style={{ border: '1px solid rgba(230, 130, 130, 0.35)', background: 'rgba(230, 130, 130, 0.06)' }}>
            <p className="font-mono text-[11.5px] text-[#f0c5c5]">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">REGISTRY</div>
            <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Record</h2>
            <div className="mt-5 space-y-2.5">
              {[
                ['controller', agent ? shortenAddress(agent.controller) : isLoading ? '…' : '—'],
                ['skill hash', agent ? `${agent.skillHash.slice(0, 10)}…${agent.skillHash.slice(-8)}` : isLoading ? '…' : '—'],
                ['metadata', agent?.metadataURI || (isLoading ? '…' : '—')],
                ['registered', agent ? new Date(Number(agent.registeredAt) * 1000).toLocaleString() : isLoading ? '…' : '—'],
              ].map(([label, value]) => (
                <div key={label} className="ledger-row flex items-center justify-between border border-white/10 bg-black/20 px-4 py-2.5">
                  <span className="font-mono text-[10.5px] tracking-[0.14em] text-[#7A7A7A]">{label}</span>
                  <span className="max-w-[60%] truncate text-right font-mono text-[11.5px] text-[#EAE4D8]">{value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">TELEMETRY</div>
            <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Protocol signals</h2>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ['SCORE', agent ? agent.score : isLoading ? '…' : '0'],
                ['JOBS', String(jobs.length)],
                ['PROOFS', String(proofs.length)],
              ].map(([label, value], i) => (
                <div key={label} className="p-4" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)', animation: `fadeInUp 0.4s ${i * 0.05}s both cubic-bezier(0.16, 1, 0.3, 1)` }}>
                  <p className="aureo-mono-label">{label}</p>
                  <p className="mt-2 aureo-display text-[28px] text-[#EAE4D8]">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 p-4" style={{ border: '1px solid rgba(197, 166, 124, 0.2)', background: 'rgba(0,0,0,0.3)' }}>
              <div className="flex items-center justify-between">
                <p className="aureo-mono-label" style={{ color: '#C5A67C' }}>REPUTATION · TREND</p>
                <span className="font-mono text-[11px] text-[#C5A67C]">{series[series.length - 1]}</span>
              </div>
              <div className="mt-3">
                <Sparkline values={series} />
              </div>
              <p className="mt-2 font-mono text-[10.5px] leading-5 text-[#7A7A7A]">
                Reputation projected from ReputationOracle, coupled to paid WorkProof mints.
              </p>
            </div>
          </section>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">JOBS</div>
            <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Linked jobs</h2>
            <div className="mt-5 space-y-3">
              {jobs.length > 0 ? (
                jobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/job/${job.id}`}
                    className="ledger-row block border border-white/10 bg-black/20 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-[12.5px] text-[#EAE4D8]">Job #{job.id}</span>
                      <span className="font-mono text-[11px] text-[#C5A67C]">{formatUSDC(BigInt(job.budget))} USDC</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 font-mono text-[10.5px] text-[#7A7A7A]">
                      <span>worker {shortenAddress(job.worker)}</span>
                      <span className="chip-status pending">{JOB_STATUS[job.status] || job.status}</span>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="p-4 font-mono text-[11.5px] text-[#7A7A7A]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
                  {isLoading ? 'Loading jobs…' : 'No jobs for this agent yet.'}
                </p>
              )}
            </div>
          </section>

          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">PROOF OF WORK</div>
            <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Soulbound history</h2>
            <div className="mt-5 space-y-3">
              {proofs.length > 0 ? (
                proofs.map((p) => (
                  <div key={p.tokenId} className="ledger-row border border-white/10 bg-black/20 px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-[12.5px] text-[#EAE4D8]">Job #{p.jobId}</span>
                      <span className="font-mono text-[11px] text-[#C5A67C]">{formatUSDC(BigInt(p.amountPaid))} USDC</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 font-mono text-[10.5px] text-[#7A7A7A]">
                      <span>payer {shortenAddress(p.payer)}</span>
                      <span>{new Date(Number(p.mintedAt) * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="p-4 font-mono text-[11.5px] text-[#7A7A7A]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
                  {isLoading ? 'Loading proofs…' : 'No WorkProofs minted for this agent yet.'}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
