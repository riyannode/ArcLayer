'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { waitForTransactionReceipt } from '@wagmi/core';
import { useAccount, useWriteContract } from 'wagmi';
import {
  buildApproveUsdcConfig,
  buildCreateJobConfig,
  buildFundJobConfig,
  buildSetBudgetConfig,
} from '@arclayer/sdk';
import { StatusBanner } from '@/components/StatusBanner';
import { formatUSDC, parseUSDC, shortenAddress } from '@/lib/contracts';
import { fetchIndexerJson, type IndexedJob, waitForIndexer } from '@/lib/indexer';
import { config } from '@/lib/wagmi';

const JOB_STATUS = ['Created', 'Budgeted', 'Funded', 'Submitted', 'Evaluated', 'Settled', 'Cancelled'] as const;

export default function JobsPage() {
  const { isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [jobs, setJobs] = useState<IndexedJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txState, setTxState] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'idle' | 'pending' | 'synced' | 'error'>('idle');
  const [createForm, setCreateForm] = useState({
    agentId: '1',
    worker: '0xf1d7143A42e07CbAEb3a7c70DAC4C9f2B675dFF0',
    evaluator: '0x9dc3f8F2E2Aa59F9300D9B40D16725317F52B074',
    jobSpec: 'audit a solidity vault adapter',
  });
  const [fundForm, setFundForm] = useState({ jobId: '1', budget: '1', amount: '1' });

  async function loadJobs() {
    setIsRefreshing(true);
    try {
      const next = await fetchIndexerJson<IndexedJob[]>('/jobs');
      setJobs(next);
    } finally { setIsRefreshing(false); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        setStatusTone('pending');
        const next = await fetchIndexerJson<IndexedJob[]>('/jobs');
        if (!cancelled) { setJobs(next); setStatusTone('synced'); }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : 'Failed to load jobs.'); setStatusTone('error'); }
      } finally { if (!cancelled) setIsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleCreateJob() {
    try {
      setIsCreating(true);
      setStatusTone('pending');
      setTxState('Submitting createJob transaction…');
      const hash = await writeContractAsync(
        buildCreateJobConfig(
          BigInt(createForm.agentId),
          createForm.worker as `0x${string}`,
          createForm.evaluator as `0x${string}`,
          createForm.jobSpec
        )
      );
      setTxState(`Waiting for ${hash.slice(0, 10)}…`);
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh…');
      const next = await waitForIndexer<IndexedJob[]>(
        '/jobs',
        (payload) => payload.some((j) => j.worker.toLowerCase() === createForm.worker.toLowerCase() && j.evaluator.toLowerCase() === createForm.evaluator.toLowerCase())
      );
      setJobs(next);
      setStatusTone('synced');
      setTxState('Job created and indexed.');
    } catch (e) {
      setTxState(e instanceof Error ? e.message : 'createJob failed.');
      setStatusTone('error');
    } finally { setIsCreating(false); }
  }

  async function handleFundJob() {
    try {
      setIsFunding(true);
      setStatusTone('pending');
      const budget = parseUSDC(fundForm.budget);
      const amount = parseUSDC(fundForm.amount);
      const jobId = BigInt(fundForm.jobId);

      setTxState('Setting budget…');
      const b = await writeContractAsync(buildSetBudgetConfig(jobId, budget));
      await waitForTransactionReceipt(config, { hash: b });

      setTxState('Approving USDC…');
      const a = await writeContractAsync(buildApproveUsdcConfig(amount));
      await waitForTransactionReceipt(config, { hash: a });

      setTxState('Funding job…');
      const f = await writeContractAsync(buildFundJobConfig(jobId, amount));
      await waitForTransactionReceipt(config, { hash: f });

      setTxState('Funding receipt confirmed. Waiting for indexer refresh…');
      const next = await waitForIndexer<IndexedJob[]>(
        '/jobs',
        (payload) => payload.some((j) => j.id === fundForm.jobId && j.fundedAmount === amount.toString())
      );
      setJobs(next);
      setStatusTone('synced');
      setTxState('Budget set, USDC approved, funding confirmed.');
    } catch (e) {
      setTxState(e instanceof Error ? e.message : 'Funding flow failed.');
      setStatusTone('error');
    } finally { setIsFunding(false); }
  }

  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="aureo-mono-label mb-3">PROTOCOL · JOBS</div>
            <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
              Indexed <span className="italic text-[#C5A67C]">jobs</span>
            </h1>
            <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[#9a9a9a]">
              Browse JobEscrow records and push create / budget / approve / fund transactions
              directly from the console. Contracts: <span className="text-[#C5A67C]">JobEscrow, USDC</span>.
            </p>
          </div>
          <div className="flex gap-3 self-start md:self-auto">
            <button onClick={() => loadJobs()} className="btn-bordered">
              {isRefreshing ? 'REFRESHING…' : 'REFRESH'}
            </button>
            <Link href="/protocol" className="btn-primary">BACK · CONSOLE</Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4" style={{ border: '1px solid rgba(230, 130, 130, 0.35)', background: 'rgba(230, 130, 130, 0.06)' }}>
            <p className="font-mono text-[11.5px] text-[#f0c5c5]">{error}</p>
          </div>
        )}

        <div className="mb-6">
          <StatusBanner
            tone={statusTone}
            title={
              statusTone === 'pending' ? 'PENDING · CONFIRMATION'
                : statusTone === 'synced' ? 'INDEXER · SYNCED'
                : statusTone === 'error' ? 'ACTION · ERROR'
                : 'READY'
            }
            body={txState || (isRefreshing ? 'Refreshing indexed jobs.' : 'Ready for create / fund flow.')}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="aureo-panel p-4 md:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="aureo-mono-label mb-2">LEDGER</div>
                <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Live jobs</h2>
              </div>
              <span className="font-mono text-[11px] text-[#C5A67C]">{jobs.length} indexed</span>
            </div>
            <div className="mt-5 space-y-3">
              {isLoading ? (
                [0, 1, 2, 3].map((i) => (
                  <div key={`skel-${i}`} className="aureo-skel block px-4 py-3 md:px-5 md:py-4">
                    <div className="flex items-center justify-between gap-4">
                      <span className="aureo-skel-bar" style={{ width: '92px' }} />
                      <span className="aureo-skel-bar" style={{ width: '86px' }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4">
                      <span className="aureo-skel-bar" style={{ width: '140px', height: '8px' }} />
                      <span className="aureo-skel-bar" style={{ width: '68px', height: '8px' }} />
                    </div>
                  </div>
                ))
              ) : jobs.length > 0 ? (
                jobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/job/${job.id}`}
                    className="aureo-list-card block px-4 py-3 md:px-5 md:py-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-[12.5px] text-[#EAE4D8]">Job #{job.id}</span>
                      <span className="font-mono text-[11px] text-[#C5A67C]">{formatUSDC(BigInt(job.budget))} USDC</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 font-mono text-[10.5px] text-[#7A7A7A]">
                      <span>worker {shortenAddress(job.worker)}</span>
                      <span className="chip-status pending">{JOB_STATUS[job.status]}</span>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="aureo-empty">
                  <span className="aureo-empty-glyph">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" /></svg>
                  </span>
                  <p className="font-mono text-[11.5px] text-[#EAE4D8]">No indexed jobs yet</p>
                  <p className="font-mono text-[10.5px] text-[#7A7A7A]">Create the first job from the panel on the right to see it indexed here.</p>
                </div>
              )}
            </div>
          </section>

          <section className="space-y-6">
            <div className="aureo-panel p-4 md:p-6">
              <div className="aureo-mono-label mb-2">ACTION · WRITE</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Create job</h2>
              <code className="mt-2 block font-mono text-[10.5px] text-[#7A7A7A]">JobEscrow.createJob(agentId, worker, evaluator, spec)</code>
              <div className="mt-5 space-y-3">
                <input value={createForm.agentId} onChange={(e) => setCreateForm((c) => ({ ...c, agentId: e.target.value }))} placeholder="agentId" className="input-mono" />
                <input value={createForm.worker} onChange={(e) => setCreateForm((c) => ({ ...c, worker: e.target.value }))} placeholder="worker 0x…" className="input-mono" />
                <input value={createForm.evaluator} onChange={(e) => setCreateForm((c) => ({ ...c, evaluator: e.target.value }))} placeholder="evaluator 0x…" className="input-mono" />
                <textarea value={createForm.jobSpec} onChange={(e) => setCreateForm((c) => ({ ...c, jobSpec: e.target.value }))} placeholder="job spec" className="input-mono min-h-[110px]" />
              </div>
              <button onClick={handleCreateJob} disabled={!isConnected || isCreating || isFunding} className="btn-primary mt-5">
                {isCreating ? 'CREATING…' : 'CREATE JOB'}
              </button>
            </div>

            <div className="aureo-panel p-4 md:p-6">
              <div className="aureo-mono-label mb-2">ACTION · WRITE</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Budget &amp; fund</h2>
              <code className="mt-2 block font-mono text-[10.5px] text-[#7A7A7A]">setBudget → approve USDC → fundJob</code>
              <div className="mt-5 space-y-3">
                <input value={fundForm.jobId} onChange={(e) => setFundForm((c) => ({ ...c, jobId: e.target.value }))} placeholder="jobId" className="input-mono" />
                <input value={fundForm.budget} onChange={(e) => setFundForm((c) => ({ ...c, budget: e.target.value }))} placeholder="budget USDC" className="input-mono" />
                <input value={fundForm.amount} onChange={(e) => setFundForm((c) => ({ ...c, amount: e.target.value }))} placeholder="funding USDC" className="input-mono" />
              </div>
              <button onClick={handleFundJob} disabled={!isConnected || isCreating || isFunding} className="btn-primary mt-5">
                {isFunding ? 'FUNDING…' : 'SET BUDGET · FUND'}
              </button>
            </div>

            <div className="p-5 font-mono text-[11.5px] leading-5 text-[#9a9a9a]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.6)' }}>
              {isConnected ? '✓ Wallet connected — ready for protocol writes.' : '⚠ Connect wallet to submit protocol writes.'}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
