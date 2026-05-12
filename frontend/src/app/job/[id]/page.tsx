'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { waitForTransactionReceipt } from '@wagmi/core';
import { useAccount, useWriteContract } from 'wagmi';
import {
  buildEvaluateJobConfig,
  buildSettleJobConfig,
  buildSubmitDeliverableConfig,
} from '@arcwork/sdk';
import { CONTRACTS, formatUSDC, getExplorerAddressUrl, shortenAddress } from '@/lib/contracts';
import { config } from '@/lib/wagmi';
import { fetchIndexerJson, INDEXER_BASE_URL, type JobDetail, waitForIndexer } from '@/lib/indexer';

const JOB_STATUS = ['Created', 'Budgeted', 'Funded', 'Submitted', 'Evaluated', 'Settled', 'Cancelled'] as const;

function parseJobId(value: string | undefined) {
  return value && /^\d+$/.test(value) ? value : null;
}

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = parseJobId(params.id);
  const { isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [payload, setPayload] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [txState, setTxState] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<'submit' | 'approve' | 'reject' | 'settle' | null>(null);
  const [deliverableURI, setDeliverableURI] = useState('ipfs://deliverable-next');
  const [proofMetadataURI, setProofMetadataURI] = useState('ipfs://proof-next');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!jobId) {
        setError('Invalid job id.');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const nextPayload = await fetchIndexerJson<JobDetail>(`/jobs/${jobId}`);
        if (!cancelled) {
          setPayload(nextPayload);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Failed to load job.');
          setPayload(null);
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
  }, [jobId]);

  const job = payload?.job || null;
  const proof = payload?.proof || null;

  async function refreshJob() {
    if (!jobId) return;
    const nextPayload = await fetchIndexerJson<JobDetail>(`/jobs/${jobId}`);
    setPayload(nextPayload);
  }

  async function handleSubmitDeliverable() {
    if (!jobId) return;
    try {
      setActiveAction('submit');
      setTxState('Submitting deliverable...');
      const hash = await writeContractAsync(
        buildSubmitDeliverableConfig(BigInt(jobId), deliverableURI, proofMetadataURI)
      );
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh...');
      const nextPayload = await waitForIndexer<JobDetail>(
        `/jobs/${jobId}`,
        (payload) => payload.job.deliverableURI === deliverableURI && payload.job.proofMetadataURI === proofMetadataURI
      );
      setPayload(nextPayload);
      setTxState('Deliverable submitted and indexed.');
    } catch (nextError) {
      setTxState(nextError instanceof Error ? nextError.message : 'submitDeliverable failed.');
    } finally {
      setActiveAction(null);
    }
  }

  async function handleEvaluate(approved: boolean) {
    if (!jobId) return;
    try {
      setActiveAction(approved ? 'approve' : 'reject');
      setTxState(approved ? 'Approving deliverable...' : 'Rejecting deliverable...');
      const hash = await writeContractAsync(buildEvaluateJobConfig(BigInt(jobId), approved));
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh...');
      const nextPayload = await waitForIndexer<JobDetail>(
        `/jobs/${jobId}`,
        (payload) => payload.job.approved === approved && payload.job.status === 4
      );
      setPayload(nextPayload);
      setTxState(approved ? 'Deliverable approved and indexed.' : 'Deliverable rejected and indexed.');
    } catch (nextError) {
      setTxState(nextError instanceof Error ? nextError.message : 'evaluate failed.');
    } finally {
      setActiveAction(null);
    }
  }

  async function handleSettle() {
    if (!jobId) return;
    try {
      setActiveAction('settle');
      setTxState('Settling job...');
      const hash = await writeContractAsync(buildSettleJobConfig(BigInt(jobId)));
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh...');
      const nextPayload = await waitForIndexer<JobDetail>(
        `/jobs/${jobId}`,
        (payload) => payload.job.status === 5 && payload.proof !== null
      );
      setPayload(nextPayload);
      setTxState('Job settled and indexed.');
    } catch (nextError) {
      setTxState(nextError instanceof Error ? nextError.message : 'settle failed.');
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <div className="relative px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/dashboard" className="text-sm font-semibold text-cyan-200">
              Back to dashboard
            </Link>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-white/35">JobEscrow</p>
            <h1 className="mt-3 font-[var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] md:text-[52px]">
              Job #{jobId || '0'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/50">
              Protocol job detail projected by the ArcLayer indexer from `JobEscrow` and linked `WorkProof` records.
            </p>
          </div>
          <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3">
            <p className="text-xs text-white/40">Budget</p>
            <p className="mt-1 font-mono text-lg font-semibold text-cyan-100">
              {job ? `${formatUSDC(BigInt(job.budget))} USDC` : isLoading ? 'Loading' : '0.00 USDC'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
            {error}
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
          {[
            ['Status', job ? JOB_STATUS[job.status] : isLoading ? 'Loading' : 'Unavailable'],
            ['Funded', job ? `${formatUSDC(BigInt(job.fundedAmount))} USDC` : isLoading ? 'Loading' : '0.00 USDC'],
            ['Approved', job ? (job.approved ? 'Yes' : 'No') : isLoading ? 'Loading' : 'No'],
            ['Proof', proof ? `Token #${proof.tokenId}` : isLoading ? 'Loading' : 'Pending'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">{label}</p>
              <p className="mt-2 font-mono text-lg text-white/75">{value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Job receipt</p>
            <div className="mt-5 space-y-3">
              {[
                ['Client', job ? shortenAddress(job.client) : isLoading ? 'Loading' : 'Unavailable'],
                ['Worker', job ? shortenAddress(job.worker) : isLoading ? 'Loading' : 'Unavailable'],
                ['Evaluator', job ? shortenAddress(job.evaluator) : isLoading ? 'Loading' : 'Unavailable'],
                ['Agent', job ? `#${job.agentId}` : isLoading ? 'Loading' : 'Unavailable'],
                ['Spec hash', job ? `${job.jobSpecHash.slice(0, 10)}...${job.jobSpecHash.slice(-8)}` : isLoading ? 'Loading' : 'Unavailable'],
                ['Created', job ? new Date(Number(job.createdAt) * 1000).toLocaleString() : isLoading ? 'Loading' : 'Unavailable'],
              ].map(([label, value]) => (
                <div key={label} className="ledger-row flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                  <span className="text-sm text-white/45">{label}</span>
                  <span className="max-w-[60%] truncate text-right font-mono text-sm text-white/75">{value}</span>
                </div>
              ))}
            </div>
            <a
              href={getExplorerAddressUrl(CONTRACTS.JOB_ESCROW)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex text-sm font-semibold text-cyan-200"
            >
              View JobEscrow contract
            </a>
          </section>

          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Deliverable and proof</p>
            <div className="mt-5 space-y-3">
              <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                <p className="text-sm font-semibold text-white">Deliverable URI</p>
                <p className="mt-2 truncate font-mono text-xs text-white/45">
                  {job?.deliverableURI || (isLoading ? 'Loading...' : 'No deliverable submitted yet.')}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                <p className="text-sm font-semibold text-white">Proof metadata URI</p>
                <p className="mt-2 truncate font-mono text-xs text-white/45">
                  {job?.proofMetadataURI || (isLoading ? 'Loading...' : 'No proof metadata yet.')}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 px-4 py-3">
                <p className="text-sm font-semibold text-white">Minted proof</p>
                {proof ? (
                  <div className="mt-2 space-y-2 text-xs text-white/45">
                    <p className="font-mono text-cyan-200">Token #{proof.tokenId}</p>
                    <p>Payer {shortenAddress(proof.payer)}</p>
                    <p>Amount {formatUSDC(BigInt(proof.amountPaid))} USDC</p>
                    <p>Minted {new Date(Number(proof.mintedAt) * 1000).toLocaleString()}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-white/45">
                    {isLoading ? 'Loading proof...' : 'No work proof minted for this job yet.'}
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>

        <section className="mt-6 glass-card p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">Job actions</p>
              <h2 className="mt-2 text-lg font-light">Submit, evaluate, and settle</h2>
            </div>
            <a href={`${INDEXER_BASE_URL}/jobs/${jobId || '0'}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-cyan-200">
              Open indexed JSON
            </a>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-3">
              <input
                value={deliverableURI}
                onChange={(event) => setDeliverableURI(event.target.value)}
                placeholder="Deliverable URI"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={proofMetadataURI}
                onChange={(event) => setProofMetadataURI(event.target.value)}
                placeholder="Proof metadata URI"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
              />
              <button
                onClick={handleSubmitDeliverable}
                disabled={!isConnected || activeAction !== null}
                className="rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {activeAction === 'submit' ? 'Submitting...' : 'Submit Deliverable'}
              </button>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => handleEvaluate(true)}
                disabled={!isConnected || activeAction !== null}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {activeAction === 'approve' ? 'Approving...' : 'Evaluate: Approve'}
              </button>
              <button
                onClick={() => handleEvaluate(false)}
                disabled={!isConnected || activeAction !== null}
                className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {activeAction === 'reject' ? 'Rejecting...' : 'Evaluate: Reject'}
              </button>
              <button
                onClick={handleSettle}
                disabled={!isConnected || activeAction !== null}
                className="w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
              >
                {activeAction === 'settle' ? 'Settling...' : 'Settle Job'}
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/45">
            {txState || (isConnected ? 'Wallet connected. Contract permissions still decide which actions succeed.' : 'Connect wallet to run submit/evaluate/settle transactions.')}
          </div>
        </section>
      </div>
    </div>
  );
}
