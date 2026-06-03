'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useSignMessage } from 'wagmi';
import { useArcWallet } from '@/hooks/useArcWallet';

// ── Types ─────────────────────────────────────────────────────────────────

type TimelineEvent = {
  type: string;
  actorAgentId?: string;
  actorRole?: string;
  txHash?: string;
  payloadHash?: string;
  createdAt: string;
};

type JobDetail = {
  localJobId: string;
  erc8183JobId: string | null;
  lifecycleStatus: string;
  localStatus: string;
  onchainStatus: string | null;
  description: string | null;
  participants: {
    client: { agentId: string; address: string | null };
    provider: { agentId: string | null; address: string | null };
    evaluator: { agentId: string | null; address: string | null };
    worker: { agentId: string | null };
  };
  budget: { atomic: string; decimals: number; formatted: string };
  expiry: { expiredAtUnix: string | null; isExpired: boolean };
  payloads: {
    inputPayloadHash: string;
    resultPayloadHash: string | null;
    proofPayloadHash: string | null;
    deliverableHash: string | null;
    reasonHash: string | null;
  };
  txHashes: {
    createTxHash: string | null;
    setBudgetTxHash: string | null;
    approveTxHash: string | null;
    fundTxHash: string | null;
    submitTxHash: string | null;
    completeTxHash: string | null;
    rejectTxHash: string | null;
  };
  rejection: {
    rejectedAt: string | null;
    rejectReasonText: string | null;
    rejectReasonHash: string | null;
  };
  timestamps: {
    createdAt: string;
    claimedAt: string | null;
    startedAt: string | null;
    submittedAt: string | null;
    settledAt: string | null;
  };
  timeline: TimelineEvent[];
};

type ApiResponse = {
  ok: boolean;
  job?: JobDetail;
  currentUserRole?: 'client' | 'provider' | 'evaluator';
  error?: string;
  message?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────

function isRejected(job: JobDetail): boolean {
  return (
    job.lifecycleStatus === 'Rejected' ||
    job.localStatus === 'rejected' ||
    job.onchainStatus === 'Rejected'
  );
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortHash(hash: string | null | undefined): string {
  if (!hash) return '—';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function explorerTxUrl(hash: string): string {
  return `https://testnet.arcscan.app/tx/${hash}`;
}

function explorerAddrUrl(addr: string): string {
  return `https://testnet.arcscan.app/address/${addr}`;
}

function statusPillColor(ls: string): string {
  switch (ls) {
    case 'Completed':
    case 'Settled':
      return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300';
    case 'Funded':
    case 'Running':
    case 'Claimed':
      return 'border-[#F3C536]/25 bg-[#F3C536]/10 text-[#F3C536]';
    case 'Submitted':
      return 'border-blue-400/25 bg-blue-400/10 text-blue-300';
    case 'Rejected':
    case 'Expired':
      return 'border-red-400/25 bg-red-400/10 text-red-300';
    default:
      return 'border-white/15 bg-white/5 text-[#EAE4D8]/60';
  }
}

function roleCopy(role?: string): string {
  switch (role) {
    case 'client':
      return 'You created this job';
    case 'provider':
      return 'This job is assigned to your provider agent';
    case 'evaluator':
      return 'You are the evaluator for this job';
    default:
      return '';
  }
}

function timelineLabel(type: string): string {
  const labels: Record<string, string> = {
    create_tx_confirmed: 'Job Created',
    budget_set_tx_confirmed: 'Budget Set',
    approve_tx_confirmed: 'USDC Approved',
    fund_tx_confirmed: 'Funded',
    worker_claimed: 'Worker Claimed',
    worker_running: 'Worker Running',
    submit_tx_confirmed: 'Deliverable Submitted',
    complete_tx_confirmed: 'Job Completed',
    reject_tx_confirmed: 'Job Rejected',
  };
  return labels[type] ?? type.replace(/_/g, ' ');
}

// ── Row Components ────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="grid gap-2 border-b border-white/[0.06] py-3 last:border-b-0 sm:grid-cols-[160px_1fr] sm:items-center">
      <div className="text-[12px] text-[#EAE4D8]/50">{label}</div>
      <div className="min-w-0 truncate font-mono text-[12px] text-[#F5F0E5]">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-[#F3C536]"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </div>
    </div>
  );
}

function ParticipantRow({
  role,
  agentId,
  address,
}: {
  role: string;
  agentId: string | null | undefined;
  address?: string | null;
}) {
  return (
    <div className="grid gap-2 border-b border-white/[0.06] py-3 last:border-b-0 sm:grid-cols-[160px_1fr] sm:items-center">
      <div className="text-[12px] text-[#EAE4D8]/50">{role}</div>
      <div className="min-w-0 space-y-0.5">
        <div className="truncate font-mono text-[12px] text-[#F5F0E5]">
          {agentId ?? '—'}
        </div>
        {address && (
          <a
            href={explorerAddrUrl(address)}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate font-mono text-[11px] text-[#EAE4D8]/40 transition hover:text-[#F3C536]"
          >
            {shortHash(address)}
          </a>
        )}
      </div>
    </div>
  );
}

// ── Collapsible Text ─────────────────────────────────────────────────────

function CollapsibleText({
  text,
  maxLength = 200,
}: {
  text: string;
  maxLength?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= maxLength) {
    return (
      <p className="whitespace-pre-wrap text-[14px] leading-6 text-[#EAE4D8]/75">
        {text}
      </p>
    );
  }
  return (
    <div>
      <p className="whitespace-pre-wrap text-[14px] leading-6 text-[#EAE4D8]/75">
        {expanded ? text : text.slice(0, maxLength) + '…'}
      </p>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mt-2 font-mono text-[11px] text-[#F3C536]/80 transition hover:text-[#F3C536]"
      >
        {expanded ? 'Show less' : 'Show full reason'}
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function Erc8183JobDetailPage() {
  const params = useParams();
  const localJobId = params.localJobId as string;
  const { isConnected, address } = useArcWallet();
  const { signMessageAsync } = useSignMessage();

  const [job, setJob] = useState<JobDetail | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [status, setStatus] = useState<
    'loading' | 'unauthenticated' | 'need_sign' | 'forbidden' | 'not_found' | 'ready' | 'error'
  >('loading');
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/erc8183-jobs/${localJobId}`);
      const data: ApiResponse = await res.json();

      if (res.status === 401) {
        // Distinguish: no wallet vs wallet connected but no session
        setStatus(isConnected ? 'need_sign' : 'unauthenticated');
        return;
      }
      if (res.status === 403) {
        setStatus('forbidden');
        return;
      }
      if (res.status === 404) {
        setStatus('not_found');
        return;
      }
      if (!data.ok || !data.job) {
        setStatus('error');
        setError(data.message || data.error || 'Failed to load job');
        return;
      }

      setJob(data.job);
      setUserRole(data.currentUserRole ?? null);
      setStatus('ready');
      setError(null);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Network error');
    }
  }, [localJobId, isConnected]);

  useEffect(() => {
    fetchJob();

    // Light polling: 30s, pause when hidden
    const startPolling = () => {
      intervalRef.current = setInterval(() => {
        if (!document.hidden) fetchJob();
      }, 30_000);
    };
    startPolling();

    const onVisibility = () => {
      if (!document.hidden) fetchJob();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchJob]);

  // Re-fetch when wallet connects
  useEffect(() => {
    if (isConnected && (status === 'unauthenticated' || status === 'need_sign')) {
      fetchJob();
    }
  }, [isConnected, status, fetchJob]);

  // ── Wallet session establishment ──────────────────────────────────────

  const handleSignIn = useCallback(async () => {
    if (!address || !signMessageAsync) return;
    setSigning(true);
    setSignError(null);
    try {
      const { ensureWalletSession } = await import('@/lib/auth/ensureWalletSession');
      const result = await ensureWalletSession(address, signMessageAsync);
      if (result.ok) {
        await fetchJob();
      } else {
        setSignError(result.error);
      }
    } catch (e) {
      setSignError(e instanceof Error ? e.message : 'Signing failed');
    } finally {
      setSigning(false);
    }
  }, [address, signMessageAsync, fetchJob]);

  return (
    <main className="min-h-screen bg-[#05070A] text-[#F5F0E5]">
      <section className="relative mx-auto max-w-[960px] px-6 pb-16 pt-10 sm:px-10 lg:px-16">
        {/* Back link */}
        <Link
          href="/dashboard"
          className="mb-6 inline-flex font-mono text-[11px] uppercase tracking-[0.18em] text-[#C5A67C] transition hover:text-[#F5F0E5]"
        >
          ← Back
        </Link>

        {/* ── Loading ── */}
        {status === 'loading' && (
          <div className="flex items-center justify-center py-20">
            <div className="font-mono text-[12px] text-[#EAE4D8]/40">
              Loading job detail…
            </div>
          </div>
        )}

        {/* ── Unauthenticated (no wallet connected) ── */}
        {status === 'unauthenticated' && (
          <div className="rounded-xl border border-[#F3C536]/20 bg-[#080D13]/78 p-10 text-center">
            <div className="mb-3 text-[18px] font-semibold text-[#F5F0E5]">
              Connect Wallet Required
            </div>
            <p className="mb-6 text-[14px] text-[#EAE4D8]/55">
              Connect your wallet to view this job detail. Only job participants
              can access full job information.
            </p>
            <div className="font-mono text-[11px] text-[#EAE4D8]/35">
              Job #{localJobId}
            </div>
          </div>
        )}

        {/* ── Wallet connected but no session — sign in required ── */}
        {status === 'need_sign' && (
          <div className="rounded-xl border border-[#F3C536]/20 bg-[#080D13]/78 p-10 text-center">
            <div className="mb-3 text-[18px] font-semibold text-[#F5F0E5]">
              Sign to View Job
            </div>
            <p className="mb-6 text-[14px] text-[#EAE4D8]/55">
              Your wallet is connected but a session is needed to verify
              participant access. Sign a message to continue.
            </p>
            <button
              type="button"
              onClick={handleSignIn}
              disabled={signing}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-[#F3C536]/35 bg-[#F3C536]/10 px-6 font-mono text-[12px] font-semibold text-[#F3C536] transition hover:border-[#F3C536]/60 hover:bg-[#F3C536]/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {signing ? 'Waiting for signature…' : 'Sign to View Job'}
            </button>
            {signError && (
              <p className="mt-4 text-[13px] text-red-300">
                {signError}
              </p>
            )}
            <div className="mt-4 font-mono text-[11px] text-[#EAE4D8]/35">
              Job #{localJobId}
            </div>
          </div>
        )}

        {/* ── Forbidden ── */}
        {status === 'forbidden' && (
          <div className="rounded-xl border border-red-500/20 bg-[#080D13]/78 p-10 text-center">
            <div className="mb-3 text-[18px] font-semibold text-[#F5F0E5]">
              Access Denied
            </div>
            <p className="mb-6 text-[14px] text-[#EAE4D8]/55">
              Your wallet does not control a participant agent for this job. Only
              the client, worker, or evaluator can view full job details.
            </p>
            <div className="font-mono text-[11px] text-[#EAE4D8]/35">
              Job #{localJobId}
            </div>
          </div>
        )}

        {/* ── Not Found ── */}
        {status === 'not_found' && (
          <div className="rounded-xl border border-white/10 bg-[#080D13]/78 p-10 text-center">
            <div className="mb-3 text-[18px] font-semibold text-[#F5F0E5]">
              Job Not Found
            </div>
            <p className="mb-6 text-[14px] text-[#EAE4D8]/55">
              No ERC-8183 job found with ID #{localJobId}.
            </p>
          </div>
        )}

        {/* ── Error ── */}
        {status === 'error' && (
          <div className="rounded-xl border border-red-500/20 bg-red-950/10 px-5 py-4 text-[13px] text-red-300">
            {error ?? 'Unknown error'}
          </div>
        )}

        {/* ── Job Detail ── */}
        {status === 'ready' && job && (
          <div className="space-y-6">
            {/* Header card */}
            <div className="rounded-xl border border-[#F3C536]/24 bg-[#080D13]/78 p-6 sm:p-8">
              <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                ERC-8183 Job Detail
              </div>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[#F5F0E5]">
                  Job #{job.localJobId}
                </h1>
                <span
                  className={`inline-flex rounded-md border px-3 py-1 font-mono text-[11px] ${statusPillColor(job.lifecycleStatus)}`}
                >
                  {job.lifecycleStatus}
                </span>
              </div>

              {userRole && (
                <p className="text-[14px] text-[#F3C536]/80">
                  {roleCopy(userRole)}
                </p>
              )}

              {job.expiry.isExpired && (
                <p className="mt-2 text-[13px] text-red-300">
                  This job has expired.
                </p>
              )}

              {/* Chain & settlement info */}
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-[#EAE4D8]/40">
                <span>Settlement: ERC-8183 Escrow</span>
                <span>Chain: Arc Testnet</span>
                {job.erc8183JobId && (
                  <span>On-chain ID: {job.erc8183JobId}</span>
                )}
              </div>
            </div>

            {/* Rejected banner */}
            {isRejected(job) && (
              <div className="rounded-xl border border-red-400/25 bg-red-950/15 px-6 py-5">
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex rounded-md border border-red-400/25 bg-red-400/10 px-3 py-1 font-mono text-[11px] text-red-300">
                    Rejected
                  </span>
                  <span className="text-[13px] text-red-300/80">
                    This job was rejected by the evaluator.
                  </span>
                </div>
                {job.rejection.rejectedAt && (
                  <p className="text-[12px] text-[#EAE4D8]/50">
                    Rejected at: {shortDate(job.rejection.rejectedAt)}
                  </p>
                )}
                {job.rejection.rejectReasonText && (
                  <div className="mt-3">
                    <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.1em] text-red-300/60">
                      Rejection Reason
                    </div>
                    <CollapsibleText text={job.rejection.rejectReasonText} />
                  </div>
                )}
                {job.rejection.rejectReasonHash && (
                  <p className="mt-2 font-mono text-[11px] text-[#EAE4D8]/40">
                    Reason Hash: {shortHash(job.rejection.rejectReasonHash)}
                  </p>
                )}
              </div>
            )}

            {/* Description card */}
            {job.description && (
              <div className="rounded-xl border border-white/[0.08] bg-[#080D13]/60 px-6 py-5">
                <h2 className="mb-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#F3C536]">
                  Description
                </h2>
                <p className="whitespace-pre-wrap text-[14px] leading-6 text-[#EAE4D8]/75">
                  {job.description}
                </p>
              </div>
            )}

            {/* Participants card */}
            <div className="rounded-xl border border-white/[0.08] bg-[#080D13]/60 px-6 py-5">
              <h2 className="mb-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#F3C536]">
                Participants
              </h2>
              <ParticipantRow
                role="Client / Buyer"
                agentId={job.participants.client.agentId}
                address={job.participants.client.address}
              />
              <ParticipantRow
                role="Worker / Provider"
                agentId={job.participants.provider.agentId}
                address={job.participants.provider.address}
              />
              <ParticipantRow
                role="Evaluator"
                agentId={job.participants.evaluator.agentId}
                address={job.participants.evaluator.address}
              />
              {job.participants.worker.agentId && (
                <ParticipantRow
                  role="Claimed By"
                  agentId={job.participants.worker.agentId}
                />
              )}
            </div>

            {/* Status & Budget card */}
            <div className="rounded-xl border border-white/[0.08] bg-[#080D13]/60 px-6 py-5">
              <h2 className="mb-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#F3C536]">
                Status & Budget
              </h2>
              <DetailRow label="Lifecycle Status" value={job.lifecycleStatus} />
              <DetailRow label="Local Status" value={job.localStatus} />
              {job.onchainStatus && (
                <DetailRow label="On-chain Status" value={job.onchainStatus} />
              )}
              <DetailRow
                label="Budget"
                value={`$${job.budget.formatted} USDC`}
              />
              {job.expiry.expiredAtUnix && (
                <DetailRow
                  label="Expires"
                  value={shortDate(
                    new Date(
                      Number(job.expiry.expiredAtUnix) * 1000,
                    ).toISOString(),
                  )}
                />
              )}
            </div>

            {/* Proof & Hashes card */}
            <div className="rounded-xl border border-white/[0.08] bg-[#080D13]/60 px-6 py-5">
              <h2 className="mb-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#F3C536]">
                Proof & Hashes
              </h2>
              <DetailRow
                label="Input Payload Hash"
                value={shortHash(job.payloads.inputPayloadHash)}
              />
              {job.payloads.deliverableHash && (
                <DetailRow
                  label="Deliverable Hash"
                  value={shortHash(job.payloads.deliverableHash)}
                />
              )}
              {job.payloads.resultPayloadHash && (
                <DetailRow
                  label="Result Payload Hash"
                  value={shortHash(job.payloads.resultPayloadHash)}
                />
              )}
              {job.payloads.reasonHash && (
                <DetailRow
                  label="Reason Hash"
                  value={shortHash(job.payloads.reasonHash)}
                />
              )}
            </div>

            {/* Transactions card */}
            <div className="rounded-xl border border-white/[0.08] bg-[#080D13]/60 px-6 py-5">
              <h2 className="mb-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#F3C536]">
                Transactions
              </h2>
              {job.txHashes.createTxHash && (
                <DetailRow
                  label="Create Tx"
                  value={shortHash(job.txHashes.createTxHash)}
                  href={explorerTxUrl(job.txHashes.createTxHash)}
                />
              )}
              {job.txHashes.setBudgetTxHash && (
                <DetailRow
                  label="Set Budget Tx"
                  value={shortHash(job.txHashes.setBudgetTxHash)}
                  href={explorerTxUrl(job.txHashes.setBudgetTxHash)}
                />
              )}
              {job.txHashes.approveTxHash && (
                <DetailRow
                  label="Approve Tx"
                  value={shortHash(job.txHashes.approveTxHash)}
                  href={explorerTxUrl(job.txHashes.approveTxHash)}
                />
              )}
              {job.txHashes.fundTxHash && (
                <DetailRow
                  label="Fund Tx"
                  value={shortHash(job.txHashes.fundTxHash)}
                  href={explorerTxUrl(job.txHashes.fundTxHash)}
                />
              )}
              {job.txHashes.submitTxHash && (
                <DetailRow
                  label="Submit Tx"
                  value={shortHash(job.txHashes.submitTxHash)}
                  href={explorerTxUrl(job.txHashes.submitTxHash)}
                />
              )}
              {job.txHashes.completeTxHash && (
                <DetailRow
                  label="Complete Tx"
                  value={shortHash(job.txHashes.completeTxHash)}
                  href={explorerTxUrl(job.txHashes.completeTxHash)}
                />
              )}
              {job.txHashes.rejectTxHash && (
                <DetailRow
                  label="Reject Tx"
                  value={shortHash(job.txHashes.rejectTxHash)}
                  href={explorerTxUrl(job.txHashes.rejectTxHash)}
                />
              )}
            </div>

            {/* Timeline card */}
            {job.timeline.length > 0 && (
              <div className="rounded-xl border border-white/[0.08] bg-[#080D13]/60 px-6 py-5">
                <h2 className="mb-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#F3C536]">
                  Timeline
                </h2>
                <div className="space-y-0">
                  {job.timeline.map((ev, i) => (
                    <div
                      key={`${ev.type}-${i}`}
                      className="flex items-start gap-3 border-b border-white/[0.04] py-3 last:border-b-0"
                    >
                      <div
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          ev.type === 'reject_tx_confirmed'
                            ? 'bg-red-400/60'
                            : 'bg-[#F3C536]/60'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-[#F5F0E5]">
                          {timelineLabel(ev.type)}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-[#EAE4D8]/40">
                          <span>{shortDate(ev.createdAt)}</span>
                          {ev.txHash && (
                            <a
                              href={explorerTxUrl(ev.txHash)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="transition hover:text-[#F3C536]"
                            >
                              {shortHash(ev.txHash)}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Timestamps card */}
            <div className="rounded-xl border border-white/[0.08] bg-[#080D13]/60 px-6 py-5">
              <h2 className="mb-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#F3C536]">
                Timestamps
              </h2>
              <DetailRow
                label="Created"
                value={shortDate(job.timestamps.createdAt)}
              />
              {job.timestamps.claimedAt && (
                <DetailRow
                  label="Claimed"
                  value={shortDate(job.timestamps.claimedAt)}
                />
              )}
              {job.timestamps.startedAt && (
                <DetailRow
                  label="Started"
                  value={shortDate(job.timestamps.startedAt)}
                />
              )}
              {job.timestamps.submittedAt && (
                <DetailRow
                  label="Submitted"
                  value={shortDate(job.timestamps.submittedAt)}
                />
              )}
              {job.timestamps.settledAt && (
                <DetailRow
                  label="Settled"
                  value={shortDate(job.timestamps.settledAt)}
                />
              )}
              {job.rejection.rejectedAt && (
                <DetailRow
                  label="Rejected"
                  value={shortDate(job.rejection.rejectedAt)}
                />
              )}
            </div>

            {/* Deliverable section — visible even when rejected */}
            {job.payloads.deliverableHash && (
              <div className="rounded-xl border border-white/[0.08] bg-[#080D13]/60 px-6 py-5">
                <h2 className="mb-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#F3C536]">
                  Deliverable
                </h2>
                <DetailRow
                  label="Deliverable Hash"
                  value={shortHash(job.payloads.deliverableHash)}
                />
                {job.timestamps.submittedAt && (
                  <DetailRow
                    label="Submitted At"
                    value={shortDate(job.timestamps.submittedAt)}
                  />
                )}
                {job.participants.provider.agentId && (
                  <DetailRow
                    label="Provider"
                    value={job.participants.provider.agentId}
                  />
                )}
              </div>
            )}

            {/* Reputation Impact card */}
            <div className="rounded-xl border border-white/[0.08] bg-[#080D13]/60 px-6 py-5">
              <h2 className="mb-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[#F3C536]">
                Reputation Impact
              </h2>
              {job.lifecycleStatus === 'Completed' ||
              job.lifecycleStatus === 'Settled' ? (
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[14px] font-semibold text-emerald-300">
                    +100
                  </span>
                  <span className="text-[13px] text-[#EAE4D8]/60">
                    Provider reputation increased
                  </span>
                </div>
              ) : isRejected(job) ? (
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[14px] font-semibold text-red-300">
                    -50
                  </span>
                  <span className="text-[13px] text-[#EAE4D8]/60">
                    Provider reputation decreased
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[14px] text-[#EAE4D8]/40">
                    Pending
                  </span>
                  <span className="text-[13px] text-[#EAE4D8]/40">
                    Reputation impact will be applied on completion or rejection
                  </span>
                </div>
              )}
            </div>

            {/* Read-only notice */}
            <div className="py-4 text-center font-mono text-[11px] text-[#EAE4D8]/30">
              This is a read-only view. Transaction actions will be available in
              a future update.
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
