'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { waitForTransactionReceipt } from '@wagmi/core';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useArcWrite } from '@/hooks/useArcWrite';
import {
  buildCompleteJobConfig,
  buildSubmitDeliverableConfig,
} from '@arclayer/sdk';
import { CONTRACTS, formatUSDC, getExplorerAddressUrl, shortenAddress } from '@/lib/contracts';
import { config } from '@/lib/wagmi';
import { fetchIndexerJson, INDEXER_BASE_URL, type JobDetail, waitForIndexer, loadJobDetail, type DataSource } from '@/lib/indexer';
import { IndexerDegradedBanner } from '@/components/IndexerDegradedBanner';
import { safeJsonCatch } from '@/lib/safeFetch';
import { safeBigInt } from '@/lib/safeNumber';
import { asString, asNumber } from '@/lib/safeShape';
import { Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';

const JOB_STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'] as const;

function parseJobId(value: string | undefined) {
  return value && /^\d+$/.test(value) ? value : null;
}

/** Detect local job ID format (erc8183_...) */
function isLocalJobId(value: string | undefined): boolean {
  return !!value && value.startsWith('erc8183_');
}

type Action = 'submit' | 'complete' | null;

type DeliverablePreview = {
  agentId?: string;
  jobId?: string;
  runId?: string;
  input?: string;
  output?: string;
  completedAt?: number;
};

const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs';

const PLACEHOLDER_URIS = new Set([
  'ipfs://deliverable-next',
  'ipfs://proof-next',
  'ipfs://test',
  'ipfs://placeholder',
]);

const CID_V0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1 = /^[a-z0-9]{50,}$/i;

function isPlaceholderURI(uri: string | null | undefined): boolean {
  if (!uri) return true;
  if (PLACEHOLDER_URIS.has(uri.toLowerCase())) return true;
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice('ipfs://'.length).split('/')[0];
    if (!cid || cid.length < 10) return true;
    if (!CID_V0.test(cid) && !CID_V1.test(cid)) return true;
  }
  return false;
}

function ipfsToHttp(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith('ipfs://')) return `${IPFS_GATEWAY}/${uri.replace('ipfs://', '')}`;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  return null;
}

/** Local API detail shape (from /api/erc8183-jobs/[localJobId]) */
type ApiJobDetail = {
  job: {
    localJobId: string;
    erc8183JobId: string;
    description?: string;
    lifecycleStatus: string;
    localStatus: string;
    onchainStatus: string;
    rejection?: {
      rejectedAt?: string;
      rejectReasonText?: string;
      rejectReasonHash?: string;
    };
    txHashes?: {
      createTxHash?: string;
      setBudgetTxHash?: string;
      approveTxHash?: string;
      fundTxHash?: string;
      submitTxHash?: string;
      completeTxHash?: string;
      rejectTxHash?: string;
    };
    timestamps?: {
      createdAt?: string;
      claimedAt?: string;
      startedAt?: string;
      submittedAt?: string;
      settledAt?: string;
    };
    timeline?: Array<{
      type: string;
      txHash?: string;
      createdAt: string;
      actorAgentId?: string;
      payloadHash?: string;
      metadata?: Record<string, unknown>;
    }>;
    participants?: {
      client?: string;
      provider?: string;
      evaluator?: string;
    };
    payloads?: {
      deliverableHash?: string;
      resultPayload?: Record<string, unknown>;
      proofPayload?: Record<string, unknown>;
      inputPayload?: Record<string, unknown>;
    };
    allowedActions?: string[];
    budget?: { atomic?: string; decimals?: number; formatted?: string };
  };
};

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const rawId = params.id;
  const isLocal = isLocalJobId(rawId);
  const jobId = isLocal ? null : parseJobId(rawId);
  const { address, isConnected } = useArcWallet();
  const { writeContractAsync } = useArcWrite();
  const [payload, setPayload] = useState<JobDetail | null>(null);
  const [dataSource, setDataSource] = useState<DataSource>('indexer');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [txState, setTxState] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<Action>(null);
  const [deliverableURI, setDeliverableURI] = useState('ipfs://deliverable-next');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [preview, setPreview] = useState<DeliverablePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── Local API detail (reject data, lifecycle, timeline) ──
  const [apiDetail, setApiDetail] = useState<ApiJobDetail | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showReason, setShowReason] = useState(false);

  // ── Fix #1: For local IDs, use API detail as primary loading source ──
  const [apiLoading, setApiLoading] = useState(isLocal);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Fix #1: For local erc8183_* IDs, skip indexer load — API detail is primary
      if (!jobId) {
        if (isLocal) { setIsLoading(false); return; }
        setError('Invalid job id.');
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true); setError(null);
        const { data, source } = await loadJobDetail(jobId);
        if (!cancelled) { setPayload(data); setDataSource(source); }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : 'Failed to load job.'); setPayload(null); }
      } finally { if (!cancelled) setIsLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [jobId, isLocal]);

  // ── Fetch local API detail — primary source for local IDs, overlay for numeric IDs ──
  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    if (isLocal) setApiLoading(true);
    fetch(`/api/erc8183-jobs/${params.id}`)
      .then(async (r) => {
        if (!r.ok) return;
        const data = await safeJsonCatch<ApiJobDetail | null>(r, null);
        if (!cancelled && data) {
          setApiDetail(data);
          // Fix #1: For local IDs, load indexer data once we know the on-chain ID
          if (isLocal && data.job?.erc8183JobId && !payload) {
            try {
              const { data: idxData, source } = await loadJobDetail(data.job.erc8183JobId);
              if (!cancelled) { setPayload(idxData); setDataSource(source); }
            } catch { /* non-fatal — API detail is primary */ }
          }
        }
      })
      .catch(() => { /* non-blocking */ })
      .finally(() => { if (!cancelled && isLocal) setApiLoading(false); });
    return () => { cancelled = true; };
  }, [params.id]);

  const job = payload?.job || null;
  const proof = payload?.proof || null;

  const safeJob = job ? {
    ...job,
    client: asString(job.client),
    provider: asString(job.provider),
    evaluator: asString(job.evaluator),
    description: asString(job.description),
    deliverable: asString(job.deliverable),
    budget: asString(job.budget),
    fundedAmount: asString(job.fundedAmount),
    createdAt: asString(job.createdAt),
    status: asNumber(job.status),
  } : null;

  const isEvaluator = !!(safeJob && address && address.toLowerCase() === safeJob.evaluator.toLowerCase());
  const isClient = !!(safeJob && address && address.toLowerCase() === safeJob.client.toLowerCase());
  const isWorker = !!(safeJob && address && address.toLowerCase() === safeJob.provider.toLowerCase());

  // Merge API detail fields
  const detail = apiDetail?.job;
  const rejection = detail?.rejection;
  const txHashes = detail?.txHashes;
  const timestamps = detail?.timestamps;
  const lifecycleStatus = detail?.lifecycleStatus;
  const onchainStatus = detail?.onchainStatus;
  const deliverableHash = detail?.payloads?.deliverableHash || safeJob?.deliverable;

  // ── Fix #2: Resolved IDs ──
  const resolvedLocalJobId = detail?.localJobId ?? (isLocal ? rawId : undefined);
  const resolvedOnchainJobId = detail?.erc8183JobId ?? jobId;

  // ── Fix #3: Merged rejected detection ──
  const isRejected =
    lifecycleStatus === 'Rejected' ||
    onchainStatus === 'Rejected' ||
    detail?.localStatus === 'rejected' ||
    safeJob?.status === 4 ||
    !!txHashes?.rejectTxHash;

  // ── Fix #4: Merged deliverable for all display/link/preview ──
  const displayDeliverable = deliverableHash ?? safeJob?.deliverable;

  // Lifecycle stepper data
  const lifecycleSteps = [
    { label: 'Created', done: !!txHashes?.createTxHash || !!safeJob, txHash: txHashes?.createTxHash, ts: timestamps?.createdAt },
    { label: 'Budget Set', done: !!txHashes?.setBudgetTxHash, txHash: txHashes?.setBudgetTxHash },
    { label: 'Funded', done: !!txHashes?.fundTxHash, txHash: txHashes?.fundTxHash },
    { label: 'Submitted', done: !!txHashes?.submitTxHash, txHash: txHashes?.submitTxHash, ts: timestamps?.submittedAt },
    { label: isRejected ? 'Rejected' : 'Completed', done: !!txHashes?.completeTxHash || !!txHashes?.rejectTxHash, txHash: txHashes?.completeTxHash || txHashes?.rejectTxHash, ts: timestamps?.settledAt || rejection?.rejectedAt, isReject: !!txHashes?.rejectTxHash },
  ];

  // Auto-fetch deliverable JSON
  useEffect(() => {
    let cancelled = false;
    if (isPlaceholderURI(displayDeliverable)) {
      setPreview(null); setPreviewError(null); setPreviewLoading(false);
      return;
    }
    const url = ipfsToHttp(displayDeliverable);
    if (!url) { setPreview(null); setPreviewError(null); return; }
    setPreviewLoading(true); setPreviewError(null);
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`gateway ${r.status}`);
        const j = await safeJsonCatch<DeliverablePreview | null>(r, null);
        if (!j) { if (!cancelled) setPreviewError('Gateway returned invalid JSON — preview unavailable.'); return; }
        if (!cancelled) setPreview(j);
      })
      .catch((e: unknown) => {
        if (!cancelled) setPreviewError(e instanceof Error ? e.message : 'fetch failed');
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [displayDeliverable]);

  async function handleSubmitDeliverable() {
    if (!resolvedOnchainJobId) return;
    try {
      setActiveAction('submit');
      setTxState('Submitting deliverable…');
      const hash = await writeContractAsync(
        buildSubmitDeliverableConfig(BigInt(resolvedOnchainJobId), deliverableURI)
      );
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh…');
      const next = await waitForIndexer<JobDetail>(
        `/jobs/${resolvedOnchainJobId}`,
        (p) => p.job.deliverable === deliverableURI
      );
      setPayload(next);
      setTxState('Deliverable submitted and indexed.');
    } catch (e) { setTxState(e instanceof Error ? e.message : 'submit failed.'); }
    finally { setActiveAction(null); }
  }

  async function handleComplete() {
    if (!resolvedOnchainJobId) return;
    try {
      setActiveAction('complete');
      setTxState('Completing job with ERC-8183 complete(jobId, reasonHash, "0x")…');
      const hash = await writeContractAsync(buildCompleteJobConfig(BigInt(resolvedOnchainJobId), 'approved'));
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh…');
      const next = await waitForIndexer<JobDetail>(
        `/jobs/${resolvedOnchainJobId}`,
        (p) => p.job.status === 3
      );
      setPayload(next);
      setTxState('Job completed and indexed.');
    } catch (e) { setTxState(e instanceof Error ? e.message : 'complete failed.'); }
    finally { setActiveAction(null); }
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  function statusBadgeColor(status: number) {
    if (status === 3) return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300';
    if (status === 4) return 'border-red-400/25 bg-red-400/10 text-red-300';
    if (status === 5) return 'border-amber-400/25 bg-amber-400/10 text-amber-300';
    return 'border-white/15 bg-white/5 text-[#EAE4D8]/70';
  }

  function stepDotColor(step: { done: boolean; isReject?: boolean }) {
    if (!step.done) return 'bg-white/20';
    if (step.isReject) return 'bg-red-400';
    return 'bg-emerald-400';
  }

  function explorerTxUrl(hash: string) {
    return `https://testnet.arcscan.app/tx/${hash}`;
  }

  function explorerAddrUrl(addr: string) {
    return `https://testnet.arcscan.app/address/${addr}`;
  }

  // ── RENDER ──
  return (
    <main className="min-h-screen bg-[#05070A] text-[#F5F0E5]">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(243,197,54,0.06),transparent_28%),radial-gradient(circle_at_80%_8%,rgba(255,255,255,0.035),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_46%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:44px_44px]" />

      <section className="relative mx-auto max-w-[1280px] px-6 pb-16 pt-10 sm:px-10 lg:px-16">
        {/* Back link */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link
            href="/protocol"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] transition hover:text-[#F5F0E5]"
          >
            ← Back to Protocol
          </Link>
          {/* Fix #6: Only show indexer link when on-chain ID is known */}
          {resolvedOnchainJobId ? (
            <a
              href={`${INDEXER_BASE_URL}/jobs/${resolvedOnchainJobId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] transition hover:text-[#F5F0E5]"
            >
              Indexer JSON ↗
            </a>
          ) : null}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-xl border border-red-500/25 bg-red-950/10 px-5 py-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Indexer degraded banner */}
        <IndexerDegradedBanner visible={dataSource === 'rpc'} className="mb-6" />

        {/* Loading */}
        {(isLoading || apiLoading) ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-white/10 bg-[#080D13]/70">
            <div className="font-mono text-[12px] text-[#EAE4D8]/55">
              Loading ERC-8183 job...
            </div>
          </div>
        ) : !safeJob && !detail ? (
          <div className="rounded-xl border border-[#F3C536]/24 bg-[#080D13]/78 p-10">
            <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-[#F3C536]">
              Job Not Found
            </div>
            <h1 className="mt-4 text-[32px] font-semibold tracking-[-0.04em]">
              No job record found for #{rawId}
            </h1>
          </div>
        ) : (
          <>
            {/* ─── Hero Card ──────────────────────────────────────────── */}
            <div className="overflow-hidden rounded-xl border border-[#1A2228] bg-[#080D13]/78 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]">
              <div className="relative p-8">
                <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(circle_at_85%_15%,rgba(243,197,54,0.12),transparent_28%),linear-gradient(135deg,transparent_40%,rgba(243,197,54,0.06)_70%,transparent_100%)]" />
                <div className="relative">
                  {/* Back + title */}
                  <div className="flex flex-wrap items-center gap-4">
                    <h1 className="text-[38px] font-semibold tracking-[-0.045em] text-[#F5F0E5]">
                      ERC-8183 Job
                    </h1>
                    <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-[14px] ${isRejected ? 'border-red-400/25 bg-red-400/10 text-red-300' : safeJob ? statusBadgeColor(safeJob.status) : 'border-white/15 bg-white/5 text-[#EAE4D8]/70'}`}>
                      {isRejected ? 'Rejected' : safeJob ? JOB_STATUS[safeJob.status] : lifecycleStatus || 'Loading…'}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-md border border-[#F3C536]/25 bg-[#F3C536]/8 px-3 py-1.5 text-[14px] text-[#F3C536]">
                      ERC-8183 Escrow
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[14px] text-[#EAE4D8]/55">
                      Arc Testnet
                    </span>
                  </div>

                  {/* Description */}
                  {(safeJob?.description || detail?.description) && (
                    <p className="mt-3 max-w-3xl text-[14px] leading-6 text-[#EAE4D8]/55">
                      {safeJob?.description || detail?.description}
                    </p>
                  )}

                  {/* Key info grid */}
                  <div className="mt-8 grid max-w-[760px] gap-4 text-[15px] md:grid-cols-[150px_1fr]">
                    <div className="text-[#F3C536]">Local Job ID:</div>
                    <div className="flex items-center gap-2 font-mono text-[13px]">
                      {resolvedLocalJobId || rawId || '—'}
                    </div>

                    <div className="text-[#F3C536]">On-chain ID:</div>
                    <div className="flex items-center gap-2 font-mono text-[13px]">
                      {resolvedOnchainJobId || '—'}
                    </div>

                    <div className="text-[#F3C536]">Settlement:</div>
                    <div>{lifecycleStatus || onchainStatus || (safeJob ? JOB_STATUS[safeJob.status] : '…')}</div>

                    {(safeJob?.description || detail?.description) && safeJob?.description !== detail?.description && (
                      <>
                        <div className="text-[#F3C536]">Description:</div>
                        <div className="text-[#EAE4D8]/55">{detail?.description || safeJob?.description}</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ─── Metric Cards ───────────────────────────────────────── */}
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Status" value={lifecycleStatus || (safeJob ? JOB_STATUS[safeJob.status] : '…')} />
              <MetricCard
                label="Budget"
                value={safeJob ? `${formatUSDC(safeBigInt(safeJob.budget))} USDC` : detail?.budget?.formatted ? `${detail.budget.formatted} USDC` : '…'}
                sub={safeJob?.fundedAmount && safeJob.fundedAmount !== safeJob.budget ? `Funded: ${formatUSDC(safeBigInt(safeJob.fundedAmount))} USDC` : undefined}
              />
              <MetricCard
                label="Reputation Impact"
                value={safeJob?.status === 3 ? '+100' : isRejected ? '-50' : 'Pending'}
                valueColor={safeJob?.status === 3 ? 'text-emerald-300' : isRejected ? 'text-red-300' : 'text-[#EAE4D8]/45'}
              />
              <MetricCard
                label="Settlement"
                value={safeJob?.status === 3 ? 'Completed' : isRejected ? 'Rejected' : safeJob?.status === 5 ? 'Expired' : 'Pending'}
                valueColor={safeJob?.status === 3 ? 'text-emerald-300' : isRejected ? 'text-red-300' : 'text-[#EAE4D8]/45'}
              />
            </div>

            {/* ─── Participants ───────────────────────────────────────── */}
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <ParticipantCard label="Client" address={safeJob?.client || detail?.participants?.client || '—'} />
              <ParticipantCard label="Provider" address={safeJob?.provider || detail?.participants?.provider || '—'} />
              <ParticipantCard label="Evaluator" address={safeJob?.evaluator || detail?.participants?.evaluator || '—'} />
            </div>

            {/* ─── Lifecycle Stepper ──────────────────────────────────── */}
            <div className="mt-8 overflow-hidden rounded-xl border border-[#1A2228] bg-[#080D13]/78 p-6">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                Lifecycle
              </div>
              <div className="mt-5 space-y-0">
                {lifecycleSteps.map((step, i) => (
                  <div key={step.label} className="flex gap-4">
                    {/* Vertical line + dot */}
                    <div className="flex flex-col items-center">
                      <div className={`h-3 w-3 rounded-full ${stepDotColor(step)}`} />
                      {i < lifecycleSteps.length - 1 && (
                        <div className={`w-px flex-1 ${step.done ? 'bg-white/20' : 'bg-white/8'}`} />
                      )}
                    </div>
                    {/* Content */}
                    <div className="pb-5 pt-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <span className={`text-[13px] font-medium ${step.done ? (step.isReject ? 'text-red-300' : 'text-[#F5F0E5]') : 'text-[#EAE4D8]/35'}`}>
                          {step.label}
                        </span>
                        {step.ts && (
                          <span className="font-mono text-[10px] text-[#EAE4D8]/35">
                            {new Date(step.ts).toLocaleString()}
                          </span>
                        )}
                      </div>
                      {step.txHash && (
                        <a
                          href={explorerTxUrl(step.txHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block font-mono text-[10px] text-[#C5A67C] transition hover:text-[#F5F0E5]"
                        >
                          {step.txHash.slice(0, 10)}…{step.txHash.slice(-8)} ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ─── Transactions ───────────────────────────────────────── */}
            {txHashes && (
              <div className="mt-8 overflow-hidden rounded-xl border border-[#1A2228] bg-[#080D13]/78 p-6">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                  Transactions
                </div>
                <div className="mt-4 space-y-2">
                  {([
                    ['Create', txHashes.createTxHash],
                    ['Set Budget', txHashes.setBudgetTxHash],
                    ['Fund', txHashes.fundTxHash],
                    ['Submit', txHashes.submitTxHash],
                    ['Complete', txHashes.completeTxHash],
                    ['Reject', txHashes.rejectTxHash],
                  ] as const).map(([label, hash]) =>
                    hash ? (
                      <TxRow key={label} label={label} hash={hash} isReject={label === 'Reject'} />
                    ) : null
                  )}
                </div>
              </div>
            )}

            {/* ─── Rejected Section ───────────────────────────────────── */}
            {isRejected && (
              <div className="mt-8 overflow-hidden rounded-xl border border-red-400/20 bg-[#080D13]/60 p-6">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center rounded-md border border-red-400/25 bg-red-400/10 px-3 py-1.5 text-[14px] text-red-300">
                    Rejected
                  </span>
                  {rejection?.rejectedAt && (
                    <span className="font-mono text-[10px] text-[#EAE4D8]/35">
                      {new Date(rejection.rejectedAt).toLocaleString()}
                    </span>
                  )}
                </div>

                {rejection?.rejectReasonText && (
                  <div className="mt-4">
                    <button
                      onClick={() => setShowReason(!showReason)}
                      className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-red-300/70 transition hover:text-red-300"
                    >
                      {showReason ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      Reason
                    </button>
                    {showReason && (
                      <p className="mt-2 rounded-lg border border-white/5 bg-black/20 p-4 text-[13px] leading-6 text-[#EAE4D8]/70">
                        {rejection?.rejectReasonText}
                      </p>
                    )}
                  </div>
                )}

                {rejection?.rejectReasonHash && (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#EAE4D8]/35">Reason Hash</span>
                    <code className="font-mono text-[11px] text-[#EAE4D8]/55">{rejection?.rejectReasonHash}</code>
                  </div>
                )}

                <div className="mt-3 font-mono text-[11px] text-red-300/60">
                  Provider reputation impact: -50
                </div>
              </div>
            )}

            {/* ─── Deliverable ────────────────────────────────────────── */}
            {displayDeliverable && (
              <div className="mt-8 overflow-hidden rounded-xl border border-[#1A2228] bg-[#080D13]/78 p-6">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                  Deliverable
                </div>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#EAE4D8]/35">Hash</span>
                    <code className="flex-1 truncate font-mono text-[11px] text-[#EAE4D8]/55">{displayDeliverable}</code>
                    <button
                      onClick={() => copyToClipboard(displayDeliverable, 'deliverable')}
                      className="shrink-0 text-[#C5A67C] transition hover:text-[#F5F0E5]"
                    >
                      {copiedField === 'deliverable' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  {/* IPFS/HTTP link */}
                  {ipfsToHttp(displayDeliverable) && !isPlaceholderURI(displayDeliverable) && (
                    <a
                      href={ipfsToHttp(displayDeliverable)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block font-mono text-[11px] text-[#C5A67C] transition hover:text-[#F5F0E5]"
                    >
                      Open deliverable ↗
                    </a>
                  )}

                  {/* Preview */}
                  {previewLoading && (
                    <p className="font-mono text-[11px] text-[#EAE4D8]/35">Fetching preview…</p>
                  )}
                  {previewError && !isPlaceholderURI(displayDeliverable) && (
                    <p className="font-mono text-[11px] text-red-300/60">Preview unavailable — {previewError}</p>
                  )}
                  {preview && (
                    <div className="space-y-2 rounded-lg border border-white/5 bg-black/20 p-4 font-mono text-[11px]">
                      {preview.output && (
                        <div>
                          <span className="text-[10px] uppercase tracking-[0.14em] text-[#F3C536]">Output</span>
                          <p className="mt-1 whitespace-pre-wrap break-words text-[#EAE4D8]/70">{preview.output}</p>
                        </div>
                      )}
                      {preview.runId && (
                        <p className="text-[10px] text-[#EAE4D8]/35">run {preview.runId.slice(0, 10)}…{preview.runId.slice(-8)}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── Reputation ─────────────────────────────────────────── */}
            <div className="mt-8 overflow-hidden rounded-xl border border-[#1A2228] bg-[#080D13]/78 p-6">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                Reputation
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/45">On Complete</div>
                  <div className="mt-2 text-[22px] text-emerald-300">+100</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/45">On Reject</div>
                  <div className="mt-2 text-[22px] text-red-300">-50</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/45">Status</div>
                  <div className={`mt-2 text-[22px] ${safeJob?.status === 3 ? 'text-emerald-300' : isRejected ? 'text-red-300' : 'text-[#EAE4D8]/45'}`}>
                    {safeJob?.status === 3 ? 'Applied' : isRejected ? 'Applied' : 'Pending'}
                  </div>
                </div>
              </div>
            </div>

            {/* ─── Settlement Proof ────────────────────────────────────── */}
            {proof && (
              <div className="mt-8 overflow-hidden rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-6">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-300">
                  Settlement Proof
                </div>
                <div className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2">
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#EAE4D8]/35">Record</span>
                    <p className="text-[#F5F0E5]">#{proof.tokenId}</p>
                  </div>
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#EAE4D8]/35">Payer</span>
                    <p className="font-mono text-[#F5F0E5]">{shortenAddress(proof.payer)}</p>
                  </div>
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#EAE4D8]/35">Amount</span>
                    <p className="text-[#F5F0E5]">{formatUSDC(safeBigInt(proof.amountPaid))} USDC</p>
                  </div>
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#EAE4D8]/35">Recorded</span>
                    <p className="text-[#F5F0E5]">{new Date(Number(proof.mintedAt) * 1000).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            )}

            {/* ─── Actions ────────────────────────────────────────────── */}
            <div className="mt-8 overflow-hidden rounded-xl border border-[#1A2228] bg-[#080D13]/78 p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                    Actions · {lifecycleStatus || (safeJob ? JOB_STATUS[safeJob.status] : '…')}
                  </div>
                  <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.03em] text-[#F5F0E5]">
                    {safeJob?.status === 3 ? 'Settlement complete' :
                     isRejected ? 'Job rejected' :
                     safeJob?.status === 2 ? 'Review deliverable, then complete' :
                     safeJob?.status === 1 ? 'Funded — awaiting provider submission' :
                     'Job lifecycle controls'}
                  </h2>
                </div>
              </div>

              {/* Caller role hint */}
              {address && (
                <div className="mt-4 rounded-lg border border-white/5 bg-black/20 px-4 py-2.5 font-mono text-[10.5px] tracking-[0.04em] text-[#EAE4D8]/35">
                  Connected as{' '}
                  {isClient && <span className="text-[#C5A67C]">CLIENT</span>}
                  {isEvaluator && <span className="text-emerald-300">EVALUATOR</span>}
                  {isWorker && <span className="text-blue-300">PROVIDER</span>}
                  {!isClient && !isEvaluator && !isWorker && <span>observer</span>}
                </div>
              )}

              {/* Primary actions */}
              <div className="mt-5 space-y-3">
                {safeJob?.status === 2 && previewError && isEvaluator && (
                  <div className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-4 py-3 font-mono text-[11px] text-amber-300">
                    Preview unavailable — you can still complete on-chain if you trust the submitted URI/hash.
                  </div>
                )}

                {safeJob?.status === 2 && isEvaluator && (
                  <button
                    onClick={handleComplete}
                    disabled={!isConnected || activeAction !== null}
                    className="inline-flex h-11 items-center rounded-lg border border-[#F0B84A]/55 bg-[#F0B84A] px-6 text-sm font-semibold text-black shadow-[0_0_34px_rgba(240,184,74,0.18)] transition hover:bg-[#FFD084] disabled:opacity-50"
                    title="ERC-8183 complete(jobId, reasonHash, 0x)"
                  >
                    {activeAction === 'complete' ? 'Completing…' : '✓ Complete Job'}
                  </button>
                )}

                {safeJob?.status === 2 && !isEvaluator && isConnected && (
                  <div className="rounded-lg border border-white/5 bg-black/20 px-4 py-3 font-mono text-[11px] text-[#EAE4D8]/35">
                    {isWorker
                      ? 'Deliverable submitted. Waiting for evaluator to complete via ERC-8183.'
                      : 'Read-only — only the evaluator can complete this ERC-8183 job.'}
                  </div>
                )}

                {safeJob?.status === 3 && (
                  <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/5 px-4 py-3 font-mono text-[11px] text-emerald-300">
                    ERC-8183 AgenticCommerce completion recorded.
                  </div>
                )}

                {safeJob && safeJob.status < 2 && (
                  <p className="font-mono text-[11px] text-[#EAE4D8]/35">
                    {safeJob.status === 1
                      ? 'Funded. The service provider should submit deliverable via ERC-8183 submit().'
                      : 'Job not yet funded. Use setBudget, USDC approve, then fund(jobId, 0x).'}
                  </p>
                )}
              </div>

              {/* Advanced manual submit */}
              <div className="mt-6 border-t border-white/[0.08] pt-4">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#EAE4D8]/35 transition hover:text-[#C5A67C]"
                >
                  {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Advanced · ERC-8183 Manual Submit
                </button>
                {showAdvanced && (
                  <div className="mt-3 space-y-3">
                    <p className="font-mono text-[10px] text-[#EAE4D8]/35">submit(jobId, deliverable, 0x) · provider only</p>
                    <input
                      value={deliverableURI}
                      onChange={(e) => setDeliverableURI(e.target.value)}
                      placeholder="ipfs://deliverable-hash-or-uri"
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-2.5 font-mono text-[12px] text-[#F5F0E5] placeholder:text-[#EAE4D8]/25 focus:border-[#F3C536]/35 focus:outline-none"
                    />
                    <button
                      onClick={handleSubmitDeliverable}
                      disabled={!isConnected || activeAction !== null}
                      className="inline-flex h-11 items-center rounded-lg border border-[#F3C536]/35 bg-black/20 px-5 font-mono text-[12px] font-semibold text-[#F3C536] transition hover:border-[#F3C536]/60 hover:bg-[#F3C536]/8 disabled:opacity-50"
                    >
                      {activeAction === 'submit' ? 'Submitting…' : 'Submit Hash'}
                    </button>
                  </div>
                )}
              </div>

              {/* Tx state */}
              {txState && (
                <div className="mt-5 rounded-lg border border-white/5 bg-black/20 px-4 py-3 font-mono text-[11px] text-[#EAE4D8]/55">
                  {txState}
                </div>
              )}
            </div>

            {/* Contract link */}
            <div className="mt-8 text-center">
              <a
                href={getExplorerAddressUrl(CONTRACTS.ERC8183_AGENTIC_COMMERCE)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] transition hover:text-[#F5F0E5]"
              >
                View ERC-8183 Contract ↗
              </a>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function MetricCard({ label, value, sub, valueColor }: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/45">{label}</div>
      <div className={`mt-2 text-[22px] ${valueColor || 'text-[#F5F0E5]'}`}>{value}</div>
      {sub && <div className="mt-1 font-mono text-[10px] text-[#EAE4D8]/35">{sub}</div>}
    </div>
  );
}

function ParticipantCard({ label, address }: { label: string; address: string }) {
  return (
    <div className="rounded-xl border border-[#1A2228] bg-[#080D13]/78 p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#F3C536]">{label}</div>
      <div className="mt-3 space-y-1.5">
        <div className="font-mono text-[12px] text-[#F5F0E5]">{shortenAddress(address)}</div>
        <a
          href={`https://testnet.arcscan.app/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block font-mono text-[10px] text-[#C5A67C] transition hover:text-[#F5F0E5]"
        >
          {address.slice(0, 8)}…{address.slice(-6)} ↗
        </a>
      </div>
    </div>
  );
}

// ─── TxRow helper ────────────────────────────────────────────────
function TxRow({ label, hash, isReject }: { label: string; hash: string; isReject?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-4 py-2.5">
      <span className={`font-mono text-[10px] uppercase tracking-[0.14em] ${isReject ? 'text-red-300/60' : 'text-[#EAE4D8]/35'}`}>
        {label}
      </span>
      <a
        href={`https://testnet.arcscan.app/tx/${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[11px] text-[#C5A67C] transition hover:text-[#F5F0E5]"
      >
        {hash.slice(0, 10)}…{hash.slice(-8)} ↗
      </a>
    </div>
  );
}