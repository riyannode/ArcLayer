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
} from '@arcwork/sdk';
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
  const [fundForm, setFundForm] = useState({
    jobId: '1',
    budget: '1',
    amount: '1',
  });

  async function loadJobs() {
    setIsRefreshing(true);
    try {
      const nextJobs = await fetchIndexerJson<IndexedJob[]>('/jobs');
      setJobs(nextJobs);
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        setStatusTone('pending');
        const nextJobs = await fetchIndexerJson<IndexedJob[]>('/jobs');
        if (!cancelled) {
          setJobs(nextJobs);
          setStatusTone('synced');
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Failed to load jobs.');
          setStatusTone('error');
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

  async function handleCreateJob() {
    try {
      setIsCreating(true);
      setStatusTone('pending');
      setTxState('Submitting createJob transaction...');
      const hash = await writeContractAsync(
        buildCreateJobConfig(
          BigInt(createForm.agentId),
          createForm.worker as `0x${string}`,
          createForm.evaluator as `0x${string}`,
          createForm.jobSpec
        )
      );
      setTxState(`Waiting for ${hash.slice(0, 10)}...`);
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh...');
      const nextJobs = await waitForIndexer<IndexedJob[]>(
        '/jobs',
        (payload) => payload.some((job) => job.worker.toLowerCase() === createForm.worker.toLowerCase() && job.evaluator.toLowerCase() === createForm.evaluator.toLowerCase())
      );
      setJobs(nextJobs);
      setStatusTone('synced');
      setTxState('Job created and indexed.');
    } catch (nextError) {
      setTxState(nextError instanceof Error ? nextError.message : 'createJob failed.');
      setStatusTone('error');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleFundJob() {
    try {
      setIsFunding(true);
      setStatusTone('pending');
      const budget = parseUSDC(fundForm.budget);
      const amount = parseUSDC(fundForm.amount);
      const jobId = BigInt(fundForm.jobId);

      setTxState('Setting budget...');
      const budgetHash = await writeContractAsync(buildSetBudgetConfig(jobId, budget));
      await waitForTransactionReceipt(config, { hash: budgetHash });

      setTxState('Approving USDC...');
      const approveHash = await writeContractAsync(buildApproveUsdcConfig(amount));
      await waitForTransactionReceipt(config, { hash: approveHash });

      setTxState('Funding job...');
      const fundHash = await writeContractAsync(buildFundJobConfig(jobId, amount));
      await waitForTransactionReceipt(config, { hash: fundHash });

      setTxState('Funding receipt confirmed. Waiting for indexer refresh...');
      const nextJobs = await waitForIndexer<IndexedJob[]>(
        '/jobs',
        (payload) => payload.some((job) => job.id === fundForm.jobId && job.fundedAmount === amount.toString())
      );
      setJobs(nextJobs);
      setStatusTone('synced');
      setTxState('Budget set, USDC approved, and funding confirmed.');
    } catch (nextError) {
      setTxState(nextError instanceof Error ? nextError.message : 'Funding flow failed.');
      setStatusTone('error');
    } finally {
      setIsFunding(false);
    }
  }

  return (
    <div className="relative px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/35">Job router</p>
            <h1 className="mt-3 font-[var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] md:text-[52px]">
              Indexed protocol jobs
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/50">
              Browse `JobEscrow` records and push create, budget, approve, and fund transactions from the console.
            </p>
          </div>
          <div className="flex gap-3 self-start md:self-auto">
            <button
              onClick={() => loadJobs()}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white/80"
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <Link href="/dashboard" className="btn-primary">
              Back to dashboard
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
            {error}
          </div>
        )}

        <div className="mb-6">
          <StatusBanner
            tone={statusTone}
            title={
              statusTone === 'pending'
                ? 'Pending Confirmation'
                : statusTone === 'synced'
                  ? 'Indexer Synced'
                  : statusTone === 'error'
                    ? 'Action Error'
                    : 'Ready'
            }
            body={
              txState ||
              (isRefreshing
                ? 'Refreshing indexed jobs from the local indexer.'
                : 'Jobs view is loaded and ready for manual refresh or a new create/fund flow.')
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="glass-card p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-light">Live jobs</h2>
              <span className="font-mono text-xs text-cyan-200">{jobs.length} indexed</span>
            </div>
            <div className="mt-5 space-y-3">
              {jobs.length > 0 ? (
                jobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/job/${job.id}`}
                    className="block rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-cyan-300/30"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm font-semibold text-white">Job #{job.id}</span>
                      <span className="font-mono text-xs text-cyan-200">{formatUSDC(BigInt(job.budget))} USDC</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 text-xs text-white/45">
                      <span>Worker {shortenAddress(job.worker)}</span>
                      <span>{JOB_STATUS[job.status]}</span>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/45">
                  {isLoading ? 'Loading jobs...' : 'No indexed jobs yet.'}
                </p>
              )}
            </div>
          </section>

          <section className="space-y-6">
            <div className="glass-card p-6">
              <h2 className="text-lg font-light">Create job</h2>
              <div className="mt-5 space-y-3">
                <input value={createForm.agentId} onChange={(event) => setCreateForm((current) => ({ ...current, agentId: event.target.value }))} placeholder="Agent ID" className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none" />
                <input value={createForm.worker} onChange={(event) => setCreateForm((current) => ({ ...current, worker: event.target.value }))} placeholder="Worker address" className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none" />
                <input value={createForm.evaluator} onChange={(event) => setCreateForm((current) => ({ ...current, evaluator: event.target.value }))} placeholder="Evaluator address" className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none" />
                <textarea value={createForm.jobSpec} onChange={(event) => setCreateForm((current) => ({ ...current, jobSpec: event.target.value }))} placeholder="Job spec text" className="min-h-[110px] w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none" />
              </div>
              <button onClick={handleCreateJob} disabled={!isConnected || isCreating || isFunding} className="mt-5 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40">
                {isCreating ? 'Creating...' : 'Create Job'}
              </button>
            </div>

            <div className="glass-card p-6">
              <h2 className="text-lg font-light">Set budget and fund</h2>
              <div className="mt-5 space-y-3">
                <input value={fundForm.jobId} onChange={(event) => setFundForm((current) => ({ ...current, jobId: event.target.value }))} placeholder="Job ID" className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none" />
                <input value={fundForm.budget} onChange={(event) => setFundForm((current) => ({ ...current, budget: event.target.value }))} placeholder="Budget in USDC" className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none" />
                <input value={fundForm.amount} onChange={(event) => setFundForm((current) => ({ ...current, amount: event.target.value }))} placeholder="Funding amount in USDC" className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none" />
              </div>
              <button onClick={handleFundJob} disabled={!isConnected || isCreating || isFunding} className="mt-5 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40">
                {isFunding ? 'Funding...' : 'Set Budget and Fund'}
              </button>
            </div>

            <div className="glass-card p-6 text-sm leading-6 text-white/45">
              {isConnected ? 'Wallet connected. Ready for create/fund flow.' : 'Connect wallet to submit protocol write transactions.'}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
