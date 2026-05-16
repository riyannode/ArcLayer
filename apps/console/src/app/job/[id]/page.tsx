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

type Action = 'submit' | 'approve' | 'reject' | 'settle' | 'approve_settle' | null;

type DeliverablePreview = {
  agentId?: string;
  jobId?: string;
  runId?: string;
  input?: string;
  output?: string;
  completedAt?: number;
};

const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs';

function ipfsToHttp(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith('ipfs://')) return `${IPFS_GATEWAY}/${uri.replace('ipfs://', '')}`;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  return null;
}

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = parseJobId(params.id);
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [payload, setPayload] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [txState, setTxState] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<Action>(null);
  const [deliverableURI, setDeliverableURI] = useState('ipfs://deliverable-next');
  const [proofMetadataURI, setProofMetadataURI] = useState('ipfs://proof-next');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [preview, setPreview] = useState<DeliverablePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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

  // Auto-fetch deliverable JSON from IPFS once a deliverableURI lands on chain.
  useEffect(() => {
    let cancelled = false;
    const url = ipfsToHttp(job?.deliverableURI);
    if (!url) { setPreview(null); setPreviewError(null); return; }
    setPreviewLoading(true);
    setPreviewError(null);
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`gateway ${r.status}`);
        return r.json();
      })
      .then((j: DeliverablePreview) => { if (!cancelled) setPreview(j); })
      .catch((e: unknown) => {
        if (!cancelled) setPreviewError(e instanceof Error ? e.message : 'fetch failed');
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [job?.deliverableURI]);

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

  // Hybrid γ: one-click flow — evaluate(true) then settle().
  // Two wallet signatures, one button. Used by the buyer/evaluator after
  // reviewing the IPFS deliverable preview.
  async function handleApproveAndSettle() {
    if (!jobId) return;
    try {
      setActiveAction('approve_settle');
      // 1. evaluate(true)
      setTxState('Step 1/2: signing approve…');
      const evalHash = await writeContractAsync(buildEvaluateJobConfig(BigInt(jobId), true));
      setTxState('Step 1/2: waiting for approve receipt…');
      await waitForTransactionReceipt(config, { hash: evalHash });

      // 2. settle()
      setTxState('Step 2/2: signing settle…');
      const settleHash = await writeContractAsync(buildSettleJobConfig(BigInt(jobId)));
      setTxState('Step 2/2: waiting for settle receipt…');
      await waitForTransactionReceipt(config, { hash: settleHash });

      setTxState('Both txs mined. Waiting for indexer refresh…');
      const next = await waitForIndexer<JobDetail>(
        `/jobs/${jobId}`,
        (p) => p.job.status === 5 && p.proof !== null
      );
      setPayload(next);
      setTxState(`Settled. WorkProof #${next.proof?.tokenId ?? '?'} minted.`);
    } catch (e) {
      setTxState(e instanceof Error ? `approve&settle failed: ${e.message}` : 'approve&settle failed.');
    } finally { setActiveAction(null); }
  }

  const statusChipClass = job
    ? job.status === 5 ? 'chip-status success'
      : job.status === 6 ? 'chip-status error'
      : 'chip-status pending'
    : 'chip-status';

  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="aureo-detail-hero mb-8 p-5 md:p-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/protocol" className="font-mono text-[11px] tracking-[0.16em] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]">
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
          <section className="aureo-panel p-4 md:p-6">
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

          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">ARTIFACTS</div>
            <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Deliverable &amp; proof</h2>
            <div className="mt-5 space-y-3">
              <ArtifactRow
                label="Deliverable URI"
                value={job?.deliverableURI || (isLoading ? '…' : 'No deliverable submitted.')}
                href={ipfsToHttp(job?.deliverableURI)}
              />
              <ArtifactRow
                label="Proof metadata URI"
                value={job?.proofMetadataURI || (isLoading ? '…' : 'No proof metadata.')}
                href={ipfsToHttp(job?.proofMetadataURI)}
              />

              {/* IPFS preview — auto-fetched once a deliverableURI is on chain */}
              {job?.deliverableURI && (
                <div className="p-4" style={{ border: '1px solid rgba(184, 205, 126, 0.25)', background: 'rgba(184, 205, 126, 0.04)' }}>
                  <p className="aureo-mono-label" style={{ color: '#B8CD7E' }}>DELIVERABLE PREVIEW · IPFS</p>
                  {previewLoading && (
                    <p className="mt-2 font-mono text-[11.5px] text-[#7A7A7A]">Fetching from IPFS gateway…</p>
                  )}
                  {previewError && (
                    <p className="mt-2 font-mono text-[11.5px] text-[#f0c5c5]">Could not fetch: {previewError}</p>
                  )}
                  {preview && (
                    <div className="mt-3 space-y-2 font-mono text-[11.5px] text-[#EAE4D8]">
                      {preview.input && (
                        <div>
                          <p className="text-[10.5px] tracking-[0.14em] text-[#7A7A7A]">INPUT</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-[#9a9a9a]">{preview.input}</p>
                        </div>
                      )}
                      {preview.output && (
                        <div>
                          <p className="text-[10.5px] tracking-[0.14em] text-[#C5A67C]">OUTPUT</p>
                          <p className="mt-1 whitespace-pre-wrap break-words">{preview.output}</p>
                        </div>
                      )}
                      {preview.runId && (
                        <p className="text-[10.5px] text-[#7A7A7A]">run {preview.runId.slice(0, 10)}…{preview.runId.slice(-8)}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

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

        {/* Actions — status-aware. The buyer-flow is: Funded→Submitted (auto by service)
            → Submitted (Approve&Settle) → Settled. Manual override stays available. */}
        <section className="aureo-panel mt-6 p-4 md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="aureo-mono-label mb-2">ACTIONS · {job ? JOB_STATUS[job.status] : '…'}</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">
                {job?.status === 5 ? 'Settlement complete' :
                 job?.status === 4 ? (job.approved ? 'Settle to release payout' : 'Rejected — no settlement') :
                 job?.status === 3 ? 'Review deliverable, then approve & settle' :
                 job?.status === 2 ? 'Funded — awaiting agent submission' :
                 'Job lifecycle controls'}
              </h2>
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

          {/* Caller authority hint */}
          {job && address && (
            <div className="mt-4 p-3 font-mono text-[10.5px] tracking-[0.04em] text-[#7A7A7A]" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
              you are{' '}
              {address.toLowerCase() === job.client.toLowerCase() && <span className="text-[#C5A67C]">CLIENT </span>}
              {address.toLowerCase() === job.evaluator.toLowerCase() && <span className="text-[#B8CD7E]">EVALUATOR </span>}
              {address.toLowerCase() === job.worker.toLowerCase() && <span className="text-[#9eb8ff]">WORKER </span>}
              {address.toLowerCase() !== job.client.toLowerCase() &&
               address.toLowerCase() !== job.evaluator.toLowerCase() &&
               address.toLowerCase() !== job.worker.toLowerCase() && <span>· not a participant</span>}
            </div>
          )}

          {/* PRIMARY: status-driven actions */}
          <div className="mt-5 space-y-3">
            {job?.status === 3 && previewError && (
              <div className="p-3 font-mono text-[11px] tracking-[0.04em]" style={{ border: '1px solid rgba(245, 200, 100, 0.35)', background: 'rgba(245, 200, 100, 0.06)', color: '#f5c864' }}>
                ⚠️ Preview unavailable — you can still approve on-chain if you trust the submitted URI.
              </div>
            )}
            {job?.status === 3 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr]">
                <button
                  onClick={handleApproveAndSettle}
                  disabled={!isConnected || activeAction !== null}
                  className="btn-primary"
                  title="Sign 2 txs: evaluate(true) + settle()"
                >
                  {activeAction === 'approve_settle' ? 'PROCESSING…' : '✓ APPROVE & SETTLE'}
                </button>
                <button
                  onClick={() => handleEvaluate(false)}
                  disabled={!isConnected || activeAction !== null}
                  className="btn-bordered"
                  style={{ borderColor: 'rgba(230, 130, 130, 0.4)', color: '#e68282' }}
                >
                  {activeAction === 'reject' ? 'REJECTING…' : '✕ REJECT'}
                </button>
              </div>
            )}

            {job?.status === 4 && job.approved && (
              <button
                onClick={handleSettle}
                disabled={!isConnected || activeAction !== null}
                className="btn-primary w-full"
              >
                {activeAction === 'settle' ? 'SETTLING…' : '⟶ SETTLE (release payout + mint WorkProof)'}
              </button>
            )}

            {job?.status === 5 && proof && (
              <div className="p-4" style={{ border: '1px solid rgba(184, 205, 126, 0.35)', background: 'rgba(184, 205, 126, 0.06)' }}>
                <p className="aureo-mono-label" style={{ color: '#B8CD7E' }}>SETTLED</p>
                <p className="mt-2 font-mono text-[12px] text-[#EAE4D8]">
                  {formatUSDC(BigInt(proof.amountPaid))} USDC paid to worker · WorkProof #{proof.tokenId} minted
                </p>
              </div>
            )}

            {job && job.status < 3 && (
              <p className="font-mono text-[11.5px] text-[#7A7A7A]">
                {job.status === 2
                  ? '✓ Funded. The service worker will auto-submit the deliverable after the next /run call.'
                  : 'Job not yet funded. Buyer must complete x402 payment first.'}
              </p>
            )}
          </div>

          {/* ADVANCED override — manual submitDeliverable, kept for ops/debug */}
          <div className="mt-6 border-t border-white/10 pt-4">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="font-mono text-[10.5px] tracking-[0.16em] text-[#7A7A7A] transition-colors hover:text-[#C5A67C]"
            >
              {showAdvanced ? '▾' : '▸'} ADVANCED · MANUAL OVERRIDE
            </button>
            {showAdvanced && (
              <div className="mt-3 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-3">
                  <p className="font-mono text-[10.5px] text-[#7A7A7A]">submitDeliverable (worker only)</p>
                  <input value={deliverableURI} onChange={(e) => setDeliverableURI(e.target.value)} placeholder="ipfs://deliverable" className="input-mono" />
                  <input value={proofMetadataURI} onChange={(e) => setProofMetadataURI(e.target.value)} placeholder="ipfs://proof-metadata" className="input-mono" />
                  <button onClick={handleSubmitDeliverable} disabled={!isConnected || activeAction !== null} className="btn-bordered w-full">
                    {activeAction === 'submit' ? 'SUBMITTING…' : 'SUBMIT DELIVERABLE'}
                  </button>
                </div>
                <div className="space-y-3">
                  <p className="font-mono text-[10.5px] text-[#7A7A7A]">individual evaluator/settle txs</p>
                  <button onClick={() => handleEvaluate(true)} disabled={!isConnected || activeAction !== null} className="btn-bordered w-full">
                    {activeAction === 'approve' ? 'APPROVING…' : 'EVALUATE · APPROVE only'}
                  </button>
                  <button onClick={handleSettle} disabled={!isConnected || activeAction !== null} className="btn-bordered w-full">
                    {activeAction === 'settle' ? 'SETTLING…' : 'SETTLE only'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 p-4 font-mono text-[11.5px] leading-5 text-[#9a9a9a]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
            {txState || (isConnected ? '✓ Wallet connected. Contract permissions decide which actions succeed.' : '⚠ Connect wallet to act on this job.')}
          </div>
        </section>
      </div>
    </div>
  );
}

function ArtifactRow({ label, value, href }: { label: string; value: string; href?: string | null }) {
  return (
    <div className="p-4" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
      <p className="aureo-mono-label">{label}</p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block truncate font-mono text-[11.5px] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]"
        >
          {value} ↗
        </a>
      ) : (
        <p className="mt-2 truncate font-mono text-[11.5px] text-[#EAE4D8]">{value}</p>
      )}
    </div>
  );
}
