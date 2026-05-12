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
} from '@arclayer/sdk';
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
      if (!jobId) { setError('Invalid job id.'); setIsLoading(false); return; }
      try {
        setIsLoading(true); setError(null);
        const next = await fetchIndexerJson<JobDetail>(`/jobs/${jobId}`);
        if (!cancelled) setPayload(next);
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : 'Failed to load job.'); setPayload(null); }
      } finally { if (!cancelled) setIsLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [jobId]);

  const job = payload?.job || null;
  const proof = payload?.proof || null;

  async function handleSubmitDeliverable() {
    if (!jobId) return;
    try {
      setActiveAction('submit');
      setTxState('Submitting deliverable…');
      const hash = await writeContractAsync(
        buildSubmitDeliverableConfig(BigInt(jobId), deliverableURI, proofMetadataURI)
      );
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh…');
      const next = await waitForIndexer<JobDetail>(
        `/jobs/${jobId}`,
        (p) => p.job.deliverableURI === deliverableURI && p.job.proofMetadataURI === proofMetadataURI
      );
      setPayload(next);
      setTxState('Deliverable submitted and indexed.');
    } catch (e) { setTxState(e instanceof Error ? e.message : 'submitDeliverable failed.'); }
    finally { setActiveAction(null); }
  }

  async function handleEvaluate(approved: boolean) {
    if (!jobId) return;
    try {
      setActiveAction(approved ? 'approve' : 'reject');
      setTxState(approved ? 'Approving deliverable…' : 'Rejecting deliverable…');
      const hash = await writeContractAsync(buildEvaluateJobConfig(BigInt(jobId), approved));
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh…');
      const next = await waitForIndexer<JobDetail>(
        `/jobs/${jobId}`,
        (p) => p.job.approved === approved && p.job.status === 4
      );
      setPayload(next);
      setTxState(approved ? 'Deliverable approved and indexed.' : 'Deliverable rejected and indexed.');
    } catch (e) { setTxState(e instanceof Error ? e.message : 'evaluate failed.'); }
    finally { setActiveAction(null); }
  }

  async function handleSettle() {
    if (!jobId) return;
    try {
      setActiveAction('settle');
      setTxState('Settling job…');
      const hash = await writeContractAsync(buildSettleJobConfig(BigInt(jobId)));
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh…');
      const next = await waitForIndexer<JobDetail>(
        `/jobs/${jobId}`,
        (p) => p.job.status === 5 && p.proof !== null
      );
      setPayload(next);
      setTxState('Job settled and indexed.');
    } catch (e) { setTxState(e instanceof Error ? e.message : 'settle failed.'); }
    finally { setActiveAction(null); }
  }

  const statusChipClass = job
    ? job.status === 5 ? 'chip-status active'
      : job.status === 6 ? 'chip-status error'
      : 'chip-status pending'
    : 'chip-status';

  return (
    <div className="relative px-6 py-16 md:px-10 md:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/dashboard" className="font-mono text-[11px] tracking-[0.16em] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]">
              ← BACK · CONSOLE
            </Link>
            <div className="aureo-mono-label mt-5 mb-3">PROTOCOL · JOB</div>
            <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
              Job <span className="italic text-[#C5A67C]">#{jobId || '0'}</span>
            </h1>
            <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[#9a9a9a]">
              JobEscrow record projected by the indexer from on-chain events and linked WorkProof.
            </p>
          </div>
          <div
            className="flex flex-col gap-1 p-4"
            style={{ border: '1px solid rgba(197, 166, 124, 0.3)', background: 'rgba(197, 166, 124, 0.06)' }}
          >
            <span className="aureo-mono-label" style={{ color: '#C5A67C' }}>BUDGET</span>
            <span className="font-mono text-[18px] text-[#EAE4D8]">
              {job ? `${formatUSDC(BigInt(job.budget))} USDC` : isLoading ? '…' : '0.00 USDC'}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4" style={{ border: '1px solid rgba(230, 130, 130, 0.35)', background: 'rgba(230, 130, 130, 0.06)' }}>
            <p className="font-mono text-[11.5px] text-[#f0c5c5]">{error}</p>
          </div>
        )}

        {/* KPIs */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['STATUS', job ? JOB_STATUS[job.status] : isLoading ? '…' : '—', statusChipClass],
            ['FUNDED', job ? `${formatUSDC(BigInt(job.fundedAmount))} USDC` : isLoading ? '…' : '0.00 USDC'],
            ['APPROVED', job ? (job.approved ? 'Yes' : 'No') : isLoading ? '…' : '—'],
            ['PROOF', proof ? `#${proof.tokenId}` : isLoading ? '…' : 'pending'],
          ].map(([label, value, chip], i) => (
            <div key={label as string} className="p-4" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.6)', animation: `fadeInUp 0.4s ${i * 0.04}s both cubic-bezier(0.16, 1, 0.3, 1)` }}>
              <p className="aureo-mono-label">{label as string}</p>
              {chip
                ? <span className={chip as string}>{value as string}</span>
                : <p className="mt-2 font-mono text-[14px] text-[#EAE4D8]">{value as string}</p>
              }
            </div>
          ))}
        </div>

        {/* Receipt + deliverable */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="p-6" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.6)' }}>
            <div className="aureo-mono-label mb-2">RECEIPT</div>
            <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Parties &amp; metadata</h2>
            <div className="mt-5 space-y-2.5">
              {[
                ['client', job ? shortenAddress(job.client) : isLoading ? '…' : '—'],
                ['worker', job ? shortenAddress(job.worker) : isLoading ? '…' : '—'],
                ['evaluator', job ? shortenAddress(job.evaluator) : isLoading ? '…' : '—'],
                ['agent', job ? `#${job.agentId}` : isLoading ? '…' : '—'],
                ['spec hash', job ? `${job.jobSpecHash.slice(0, 10)}…${job.jobSpecHash.slice(-8)}` : isLoading ? '…' : '—'],
                ['created', job ? new Date(Number(job.createdAt) * 1000).toLocaleString() : isLoading ? '…' : '—'],
              ].map(([label, value]) => (
                <div key={label} className="ledger-row flex items-center justify-between border border-white/10 bg-black/20 px-4 py-2.5">
                  <span className="font-mono text-[10.5px] tracking-[0.14em] text-[#7A7A7A]">{label}</span>
                  <span className="max-w-[60%] truncate text-right font-mono text-[11.5px] text-[#EAE4D8]">{value}</span>
                </div>
              ))}
            </div>
            <a
              href={getExplorerAddressUrl(CONTRACTS.JOB_ESCROW)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex font-mono text-[11px] tracking-[0.14em] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]"
            >
              VIEW CONTRACT ↗
            </a>
          </section>

          <section className="p-6" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.6)' }}>
            <div className="aureo-mono-label mb-2">ARTIFACTS</div>
            <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Deliverable &amp; proof</h2>
            <div className="mt-5 space-y-3">
              <ArtifactRow label="Deliverable URI" value={job?.deliverableURI || (isLoading ? '…' : 'No deliverable submitted.')} />
              <ArtifactRow label="Proof metadata URI" value={job?.proofMetadataURI || (isLoading ? '…' : 'No proof metadata.')} />
              <div className="p-4" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
                <p className="aureo-mono-label" style={{ color: '#B8CD7E' }}>MINTED PROOF</p>
                {proof ? (
                  <div className="mt-2 space-y-1 font-mono text-[11px] text-[#9a9a9a]">
                    <p className="text-[#C5A67C]">Token #{proof.tokenId}</p>
                    <p>payer {shortenAddress(proof.payer)}</p>
                    <p>amount {formatUSDC(BigInt(proof.amountPaid))} USDC</p>
                    <p>minted {new Date(Number(proof.mintedAt) * 1000).toLocaleString()}</p>
                  </div>
                ) : (
                  <p className="mt-2 font-mono text-[11.5px] text-[#7A7A7A]">
                    {isLoading ? 'Loading proof…' : 'No work proof minted for this job.'}
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Actions */}
        <section className="mt-6 p-6" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.6)' }}>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="aureo-mono-label mb-2">ACTIONS · WRITE</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Submit · evaluate · settle</h2>
            </div>
            <a
              href={`${INDEXER_BASE_URL}/jobs/${jobId || '0'}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] tracking-[0.14em] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]"
            >
              OPEN INDEXED JSON ↗
            </a>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-3">
              <input value={deliverableURI} onChange={(e) => setDeliverableURI(e.target.value)} placeholder="ipfs://deliverable" className="input-mono" />
              <input value={proofMetadataURI} onChange={(e) => setProofMetadataURI(e.target.value)} placeholder="ipfs://proof-metadata" className="input-mono" />
              <button onClick={handleSubmitDeliverable} disabled={!isConnected || activeAction !== null} className="btn-primary">
                {activeAction === 'submit' ? 'SUBMITTING…' : 'SUBMIT DELIVERABLE'}
              </button>
            </div>

            <div className="space-y-3">
              <button onClick={() => handleEvaluate(true)} disabled={!isConnected || activeAction !== null} className="btn-bordered w-full">
                {activeAction === 'approve' ? 'APPROVING…' : 'EVALUATE · APPROVE'}
              </button>
              <button onClick={() => handleEvaluate(false)} disabled={!isConnected || activeAction !== null} className="btn-bordered w-full" style={{ borderColor: 'rgba(230, 130, 130, 0.4)', color: '#e68282' }}>
                {activeAction === 'reject' ? 'REJECTING…' : 'EVALUATE · REJECT'}
              </button>
              <button onClick={handleSettle} disabled={!isConnected || activeAction !== null} className="btn-primary w-full">
                {activeAction === 'settle' ? 'SETTLING…' : 'SETTLE JOB'}
              </button>
            </div>
          </div>

          <div className="mt-5 p-4 font-mono text-[11.5px] leading-5 text-[#9a9a9a]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
            {txState || (isConnected ? '✓ Wallet connected. Contract permissions decide which actions succeed.' : '⚠ Connect wallet to run submit / evaluate / settle.')}
          </div>
        </section>
      </div>
    </div>
  );
}

function ArtifactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
      <p className="aureo-mono-label">{label}</p>
      <p className="mt-2 truncate font-mono text-[11.5px] text-[#EAE4D8]">{value}</p>
    </div>
  );
}
