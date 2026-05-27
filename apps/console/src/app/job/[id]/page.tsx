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
import { asArray, asString, asNumber } from '@/lib/safeShape';

const JOB_STATUS = ['Open', 'Funded', 'Submitted', 'Completed', 'Rejected', 'Expired'] as const;

function parseJobId(value: string | undefined) {
  return value && /^\d+$/.test(value) ? value : null;
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

// Known placeholder URIs used by the contract before a real deliverable is pinned.
const PLACEHOLDER_URIS = new Set([
  'ipfs://deliverable-next',
  'ipfs://proof-next',
  'ipfs://test',
  'ipfs://placeholder',
]);

// CIDv0 (Qm…46) or CIDv1 (bafy…) — keep the regex permissive but real-CID-shaped.
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

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = parseJobId(params.id);
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!jobId) { setError('Invalid job id.'); setIsLoading(false); return; }
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
  }, [jobId]);

  const job = payload?.job || null;
  const proof = payload?.proof || null;

  // Normalize job fields — valid JSON but wrong shape can crash .toLowerCase, BigInt, .map
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

  // Role checks for UI gating
  const isEvaluator = !!(safeJob && address && address.toLowerCase() === safeJob.evaluator.toLowerCase());
  const isClient = !!(safeJob && address && address.toLowerCase() === safeJob.client.toLowerCase());
  const isWorker = !!(safeJob && address && address.toLowerCase() === safeJob.provider.toLowerCase());

  // Auto-fetch deliverable JSON only when a real IPFS CID or HTTPS URL is submitted.
  useEffect(() => {
    let cancelled = false;
    if (isPlaceholderURI(safeJob?.deliverable)) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    const url = ipfsToHttp(safeJob?.deliverable);
    if (!url) { setPreview(null); setPreviewError(null); return; }
    setPreviewLoading(true);
    setPreviewError(null);
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
  }, [safeJob?.deliverable]);

  async function handleSubmitDeliverable() {
    if (!jobId) return;
    try {
      setActiveAction('submit');
      setTxState('Submitting deliverable…');
      const hash = await writeContractAsync(
        buildSubmitDeliverableConfig(BigInt(jobId), deliverableURI)
      );
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh…');
      const next = await waitForIndexer<JobDetail>(
        `/jobs/${jobId}`,
        (p) => p.job.deliverable === deliverableURI || p.job.deliverable === deliverableURI
      );
      setPayload(next);
      setTxState('Deliverable submitted and indexed.');
    } catch (e) { setTxState(e instanceof Error ? e.message : 'submit failed.'); }
    finally { setActiveAction(null); }
  }

  async function handleComplete() {
    if (!jobId) return;
    try {
      setActiveAction('complete');
      setTxState('Completing job with ERC-8183 complete(jobId, reasonHash, "0x")…');
      const hash = await writeContractAsync(buildCompleteJobConfig(BigInt(jobId), 'approved'));
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh…');
      const next = await waitForIndexer<JobDetail>(
        `/jobs/${jobId}`,
        (p) => p.job.status === 3
      );
      setPayload(next);
      setTxState('Job completed and indexed.');
    } catch (e) { setTxState(e instanceof Error ? e.message : 'complete failed.'); }
    finally { setActiveAction(null); }
  }

  const statusChipClass = safeJob
    ? safeJob.status === 3 ? 'chip-status success' : safeJob.status === 4 ? 'chip-status error' : 'chip-status pending'
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
            <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[#b5b5b5] invisible">
              ERC-8183 AgenticCommerce job projected by the ArcLayer indexer.
            </p>
          </div>
          <div
            className="flex flex-col gap-1 p-4"
            style={{ border: '1px solid rgba(197, 166, 124, 0.3)', background: 'rgba(197, 166, 124, 0.06)' }}
          >
            <span className="aureo-mono-label" style={{ color: '#C5A67C' }}>BUDGET</span>
            <span className="font-mono text-[18px] text-[#EAE4D8]">
              {safeJob ? `${formatUSDC(safeBigInt(safeJob.budget))} USDC` : isLoading ? '…' : '0.00 USDC'}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4" style={{ border: '1px solid rgba(230, 130, 130, 0.35)', background: 'rgba(230, 130, 130, 0.06)' }}>
            <p className="font-mono text-[11.5px] text-[#f0c5c5]">{error}</p>
          </div>
        )}

        <IndexerDegradedBanner visible={dataSource === 'rpc'} className="mb-6" />

        {/* KPIs */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['STATUS', safeJob ? JOB_STATUS[safeJob.status] : isLoading ? '…' : '—', statusChipClass],
            ['FUNDED', safeJob ? `${formatUSDC(safeBigInt(safeJob.fundedAmount))} USDC` : isLoading ? '…' : '0.00 USDC'],
            ['DELIVERABLE', safeJob?.deliverable ? 'Submitted' : isLoading ? '…' : 'pending'],
            ['SETTLEMENT', safeJob?.status === 3 ? 'Completed' : safeJob?.status === 4 ? 'Rejected' : safeJob?.status === 5 ? 'Expired' : isLoading ? '…' : 'pending'],
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
                ['client', safeJob ? shortenAddress(safeJob.client) : isLoading ? '…' : '—'],
                ['provider', safeJob ? shortenAddress(safeJob.provider) : isLoading ? '…' : '—'],
                ['evaluator', safeJob ? shortenAddress(safeJob.evaluator) : isLoading ? '…' : '—'],
                ['description', safeJob?.description || (isLoading ? '…' : '—')],
                ['created', safeJob ? new Date(Number(safeJob.createdAt) * 1000).toLocaleString() : isLoading ? '…' : '—'],
              ].map(([label, value]) => (
                <div key={label} className="ledger-row flex items-center justify-between border border-white/10 bg-black/20 px-4 py-2.5">
                  <span className="font-mono text-[10.5px] tracking-[0.14em] text-[#a0a0a0]">{label}</span>
                  <span className="max-w-[60%] truncate text-right font-mono text-[11.5px] text-[#EAE4D8]">{value}</span>
                </div>
              ))}
            </div>
            <a
              href={getExplorerAddressUrl(CONTRACTS.ERC8183_AGENTIC_COMMERCE)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex font-mono text-[11px] tracking-[0.14em] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]"
            >
              VIEW ERC-8183 ↗
            </a>
          </section>

          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">ARTIFACTS</div>
            <h2 className="aureo-display text-[24px] text-[#EAE4D8]">Deliverable &amp; settlement</h2>
            <div className="mt-5 space-y-3">
              <ArtifactRow
                label="Deliverable URI"
                value={safeJob?.deliverable || (isLoading ? '…' : 'No deliverable submitted.')}
                href={ipfsToHttp(safeJob?.deliverable)}
              />
              <ArtifactRow
                label="Deliverable hash"
                value={safeJob?.deliverable || (isLoading ? '…' : 'No deliverable hash.')}
              />

              {/* Submitted work preview */}
              {safeJob?.deliverable && (
                <div className="p-4" style={{ border: '1px solid rgba(184, 205, 126, 0.25)', background: 'rgba(184, 205, 126, 0.04)' }}>
                  <p className="aureo-mono-label" style={{ color: '#B8CD7E' }}>SUBMITTED WORK PREVIEW</p>

                  {/* Always show the raw URI + copy */}
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 truncate font-mono text-[10.5px] text-[#b5b5b5]">{safeJob.deliverable}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(safeJob.deliverable)}
                      className="shrink-0 font-mono text-[9px] tracking-[0.14em] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]"
                      title="Copy URI"
                    >
                      COPY
                    </button>
                    {ipfsToHttp(safeJob.deliverable) && !isPlaceholderURI(safeJob.deliverable) && (
                      <a
                        href={ipfsToHttp(safeJob.deliverable)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 font-mono text-[9px] tracking-[0.14em] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]"
                      >
                        OPEN ↗
                      </a>
                    )}
                  </div>

                  {/* Placeholder URI — explain clearly */}
                  {isPlaceholderURI(safeJob.deliverable) && (
                    <p className="mt-3 font-mono text-[11px] text-[#f5c864]">
                      No valid work file submitted yet. Please submit a real IPFS CID or HTTPS link.
                    </p>
                  )}

                  {/* Loading state */}
                  {previewLoading && (
                    <p className="mt-2 font-mono text-[11.5px] text-[#a0a0a0]">Fetching preview…</p>
                  )}

                  {/* Fetch error — human-readable */}
                  {previewError && !isPlaceholderURI(safeJob.deliverable) && (
                    <div className="mt-3">
                      <p className="font-mono text-[11px] text-[#f0c5c5]">
                        Preview unavailable. The submitted work link could not be opened.
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-[#a0a0a0]">
                        CID invalid, unpinned, or gateway unavailable.
                      </p>
                    </div>
                  )}

                  {/* Successful preview */}
                  {preview && (
                    <div className="mt-3 space-y-2 font-mono text-[11.5px] text-[#EAE4D8]">
                      {preview.input && (
                        <div>
                          <p className="text-[10.5px] tracking-[0.14em] text-[#a0a0a0]">INPUT</p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-[#b5b5b5]">{preview.input}</p>
                        </div>
                      )}
                      {preview.output && (
                        <div>
                          <p className="text-[10.5px] tracking-[0.14em] text-[#C5A67C]">OUTPUT</p>
                          <p className="mt-1 whitespace-pre-wrap break-words">{preview.output}</p>
                        </div>
                      )}
                      {preview.runId && (
                        <p className="text-[10.5px] text-[#a0a0a0]">run {preview.runId.slice(0, 10)}…{preview.runId.slice(-8)}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="p-4" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
                <p className="aureo-mono-label" style={{ color: '#B8CD7E' }}>OFFICIAL ERC-8183 SETTLEMENT</p>
                {proof ? (
                  <div className="mt-2 space-y-1 font-mono text-[11px] text-[#b5b5b5]">
                    <p className="text-[#C5A67C]">Record #{proof.tokenId}</p>
                    <p>payer {shortenAddress(proof.payer)}</p>
                    <p>amount {formatUSDC(safeBigInt(proof.amountPaid))} USDC</p>
                    <p>recorded {new Date(Number(proof.mintedAt) * 1000).toLocaleString()}</p>
                  </div>
                ) : (
                  <p className="mt-2 font-mono text-[11.5px] text-[#a0a0a0]">
                    {isLoading ? 'Loading…' : 'No ERC-8183 completion recorded for this job.'}
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Actions — official ERC-8183 flow only: submit(jobId, deliverable, "0x") → complete(jobId, reasonHash, "0x"). */}
        <section className="aureo-panel mt-6 p-4 md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="aureo-mono-label mb-2">ACTIONS · {safeJob ? JOB_STATUS[safeJob.status] : '…'}</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">
                {safeJob?.status === 3 ? 'Settlement complete' :
                 safeJob?.status === 2 ? 'Review deliverable, then complete'  :
                 safeJob?.status === 1 ? 'Funded — awaiting provider submission' :
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
          {safeJob && address && (
            <div className="mt-4 p-3 font-mono text-[10.5px] tracking-[0.04em] text-[#a0a0a0]" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.2)' }}>
              you are{' '}
              {address.toLowerCase() === safeJob.client.toLowerCase() && <span className="text-[#C5A67C]">CLIENT </span>}
              {address.toLowerCase() === safeJob.evaluator.toLowerCase() && <span className="text-[#B8CD7E]">EVALUATOR </span>}
              {address.toLowerCase() === safeJob.provider.toLowerCase() && <span className="text-[#9eb8ff]">PROVIDER </span>}
              {address.toLowerCase() !== safeJob.client.toLowerCase() &&
               address.toLowerCase() !== safeJob.evaluator.toLowerCase() &&
               address.toLowerCase() !== safeJob.provider.toLowerCase() && <span>· not a participant</span>}
            </div>
          )}

          {/* PRIMARY: status-driven actions */}
          <div className="mt-5 space-y-3">
            {safeJob?.status === 2 && previewError && isEvaluator && (
              <div className="p-3 font-mono text-[11px] tracking-[0.04em]" style={{ border: '1px solid rgba(245, 200, 100, 0.35)', background: 'rgba(245, 200, 100, 0.06)', color: '#f5c864' }}>
                ⚠️ Preview unavailable — you can still complete on-chain if you trust the submitted URI/hash.
              </div>
            )}
            {safeJob?.status === 2 && isEvaluator && (
              <button
                onClick={handleComplete}
                disabled={!isConnected || activeAction !== null}
                className="btn-primary w-full"
                title="ERC-8183 complete(jobId, reasonHash, 0x)"
              >
                {activeAction === 'complete' ? 'COMPLETING…' : '✓ COMPLETE JOB'}
              </button>
            )}
            {safeJob?.status === 2 && !isEvaluator && isConnected && (
              <div className="p-3 font-mono text-[11px] tracking-[0.04em] text-[#a0a0a0]" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.2)' }}>
                {isWorker
                  ? '⏳ Deliverable submitted. Waiting for evaluator to complete via ERC-8183.'
                  : '👁 Read-only — only the evaluator can complete this ERC-8183 job.'}
              </div>
            )}

            {safeJob?.status === 3 && (
              <div className="p-4" style={{ border: '1px solid rgba(184, 205, 126, 0.35)', background: 'rgba(184, 205, 126, 0.06)' }}>
                <p className="aureo-mono-label" style={{ color: '#B8CD7E' }}>COMPLETED</p>
                <p className="mt-2 font-mono text-[12px] text-[#EAE4D8]">
                  ERC-8183 AgenticCommerce completion recorded.
                </p>
              </div>
            )}

            {safeJob && safeJob.status < 2 && (
              <p className="font-mono text-[11.5px] text-[#a0a0a0]">
                {safeJob.status === 1
                  ? '✓ Funded. The service provider should submit deliverable via ERC-8183 submit().'
                  : 'Job not yet funded. Use setBudget, USDC approve, then fund(jobId, 0x).'}
              </p>
            )}
          </div>

          {/* ADVANCED override — manual ERC-8183 submit(), kept for ops/debug */}
          <div className="mt-6 border-t border-white/10 pt-4">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="font-mono text-[10.5px] tracking-[0.16em] text-[#a0a0a0] transition-colors hover:text-[#C5A67C]"
            >
              {showAdvanced ? '▾' : '▸'} ADVANCED · ERC-8183 MANUAL SUBMIT
            </button>
            {showAdvanced && (
              <div className="mt-3 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-3">
                  <p className="font-mono text-[10.5px] text-[#a0a0a0]">submit(jobId, deliverable, 0x) · provider only</p>
                  <input value={deliverableURI} onChange={(e) => setDeliverableURI(e.target.value)} placeholder="ipfs://deliverable-hash-or-uri" className="input-mono" />
                  <button onClick={handleSubmitDeliverable} disabled={!isConnected || activeAction !== null} className="btn-bordered w-full">
                    {activeAction === 'submit' ? 'SUBMITTING…' : 'SUBMIT HASH'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 p-4 font-mono text-[11.5px] leading-5 text-[#b5b5b5]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
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

