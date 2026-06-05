'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { type Address } from 'viem';
import { useSignMessage } from 'wagmi';
import {
  ArrowLeft,
  Check,
  Clock,
  ExternalLink,
  Loader2,
  Shield,
  X,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useCircleWallet } from '@/hooks/useCircleWallet';
import { useArcWallet } from '@/hooks/useArcWallet';
import { ensureWalletSession } from '@/lib/auth/ensureWalletSession';

// ── Types ─────────────────────────────────────────────────────────────────

type ApprovalStatus =
  | 'awaiting_approval'
  | 'approved'
  | 'cancelled'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'expired';

interface Approval {
  id: string;
  action: string;
  chainId: number;
  toAddress: string;
  data: string;
  value: string;
  summary: Record<string, unknown>;
  status: ApprovalStatus;
  txHash: string | null;
  error: string | null;
  ownerAddress: string;
  agentAccountAddress: string;
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  cancelledAt: string | null;
  submittedAt: string | null;
  confirmedAt: string | null;
}

type PagePhase =
  | 'loading'
  | 'wallet_required'
  | 'wallet_mismatch'
  | 'not_found'
  | 'expired'
  | 'ready'
  | 'approving'
  | 'cancelling'
  | 'executing'
  | 'submitting'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

// ── Helpers ───────────────────────────────────────────────────────────────

function shortAddress(value: string) {
  if (!value || value.length < 14) return value || '—';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function shortHash(value: string) {
  if (!value || value.length < 18) return value || '—';
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function timeLeft(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function statusLabel(status: ApprovalStatus): string {
  const map: Record<ApprovalStatus, string> = {
    awaiting_approval: 'Awaiting Approval',
    approved: 'Approved',
    cancelled: 'Cancelled',
    submitted: 'Submitted',
    confirmed: 'Confirmed',
    failed: 'Failed',
    expired: 'Expired',
  };
  return map[status] ?? status;
}

function statusColor(status: ApprovalStatus): string {
  switch (status) {
    case 'awaiting_approval':
      return 'border-[#F3C536]/20 bg-[#F3C536]/10 text-[#F3C536]';
    case 'approved':
      return 'border-[#B8CD7E]/20 bg-[#B8CD7E]/10 text-[#B8CD7E]';
    case 'submitted':
      return 'border-[#6B9BFF]/20 bg-[#6B9BFF]/10 text-[#6B9BFF]';
    case 'confirmed':
      return 'border-[#B8CD7E]/20 bg-[#B8CD7E]/10 text-[#B8CD7E]';
    case 'failed':
    case 'cancelled':
    case 'expired':
      return 'border-[#FF6B6B]/20 bg-[#FF6B6B]/10 text-[#FF6B6B]';
    default:
      return 'border-white/10 bg-white/5 text-[#EAE4D8]/60';
  }
}

// ── Field Row ─────────────────────────────────────────────────────────────

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="shrink-0 text-[12px] font-medium tracking-[-0.02em] text-[#EAE4D8]/50">
        {label}
      </span>
      <span
        className={`text-right text-[13px] text-[#F5F0E5] ${mono ? 'font-mono text-[12px]' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

export default function McpApprovalPage() {
  const params = useParams();
  const approvalId = params.id as string;

  const { isConnected, address, ready: walletReady } = useArcWallet();
  const { signMessageAsync } = useSignMessage();
  const {
    authenticated: circleAuthenticated,
    address: circleAddress,
    bundlerClient,
    login: circleLogin,
  } = useCircleWallet();

  const [approval, setApproval] = useState<Approval | null>(null);
  const [phase, setPhase] = useState<PagePhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch approval ──────────────────────────────────────────────────

  const fetchApproval = useCallback(async (): Promise<Approval | null> => {
    try {
      const res = await fetch(`/api/mcp/approvals/${approvalId}/page`, {
        cache: 'no-store',
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        if (res.status === 401) return null;
        if (res.status === 403) {
          setPhase('wallet_mismatch');
          return null;
        }
        if (res.status === 404) {
          setPhase('not_found');
          return null;
        }
        setError(data.error || 'Failed to load approval');
        return null;
      }

      return data.approval as Approval;
    } catch {
      setError('Network error');
      return null;
    }
  }, [approvalId]);

  // ── Initial load ────────────────────────────────────────────────────

  useEffect(() => {
    if (!walletReady) return;

    if (!isConnected || !address) {
      setPhase('wallet_required');
      return;
    }

    let cancelled = false;

    (async () => {
      const sessionOk = await ensureWalletSession(address, signMessageAsync);
      if (cancelled) return;

      if (!sessionOk.ok) {
        setError(sessionOk.error);
        setPhase('wallet_required');
        return;
      }

      const a = await fetchApproval();
      if (cancelled || !a) return;

      setApproval(a);

      if (a.status === 'confirmed') {
        setPhase('confirmed');
      } else if (a.status === 'failed') {
        setPhase('failed');
      } else if (a.status === 'cancelled') {
        setPhase('cancelled');
      } else if (a.status === 'expired' || new Date(a.expiresAt).getTime() < Date.now()) {
        setPhase('expired');
      } else {
        setPhase('ready');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletReady, isConnected, address, signMessageAsync, fetchApproval]);

  // ── Countdown timer ─────────────────────────────────────────────────

  useEffect(() => {
    if (!approval || phase === 'confirmed' || phase === 'failed' || phase === 'cancelled') return;

    const tick = () => {
      const left = timeLeft(approval.expiresAt);
      setCountdown(left);
      if (left === 'Expired' && phase === 'ready') {
        setPhase('expired');
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [approval, phase]);

  // ── Poll status after submit ────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'submitting' && phase !== 'confirming') {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    pollRef.current = setInterval(async () => {
      const a = await fetchApproval();
      if (!a) return;
      setApproval(a);
      if (a.status === 'confirmed') setPhase('confirmed');
      else if (a.status === 'failed') setPhase('failed');
    }, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [phase, fetchApproval]);

  // ── Actions ─────────────────────────────────────────────────────────

  async function handleApprove() {
    setPhase('approving');
    setError(null);
    try {
      const res = await fetch(`/api/mcp/approvals/${approvalId}/page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'Approve failed');
        setPhase('ready');
        return;
      }
      setApproval(data.approval);
      setPhase('ready');
    } catch {
      setError('Network error');
      setPhase('ready');
    }
  }

  async function handleCancel() {
    setPhase('cancelling');
    setError(null);
    try {
      const res = await fetch(`/api/mcp/approvals/${approvalId}/page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'Cancel failed');
        setPhase('ready');
        return;
      }
      setApproval(data.approval);
      setPhase('cancelled');
    } catch {
      setError('Network error');
      setPhase('ready');
    }
  }

  async function handleExecute() {
    if (!bundlerClient || !approval) {
      setError('Circle Agent Account not connected. Please login with passkey first.');
      return;
    }

    // Verify Circle address matches approval's agent account
    if (circleAddress.toLowerCase() !== approval.agentAccountAddress.toLowerCase()) {
      setError(
        `Circle Agent Account mismatch. Expected ${shortAddress(approval.agentAccountAddress)}, got ${shortAddress(circleAddress)}.`,
      );
      return;
    }

    setPhase('executing');
    setError(null);

    try {
      // Send user operation via Circle Smart Account bundler
      const userOpHash = await bundlerClient.sendUserOperation({
        calls: [
          {
            to: approval.toAddress as Address,
            data: approval.data as `0x${string}`,
            value: BigInt(approval.value || '0x0'),
          },
        ],
      });

      // Wait for the user operation to be included
      const receipt = await bundlerClient.waitForUserOperationReceipt({
        hash: userOpHash,
      });

      const txHash = receipt.receipt.transactionHash;

      // Submit txHash
      setPhase('submitting');
      const submitRes = await fetch(`/api/mcp/approvals/${approvalId}/page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', txHash }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok || !submitData.ok) {
        setError(submitData.error || 'Submit txHash failed');
        setPhase('ready');
        return;
      }
      setApproval(submitData.approval);

      // Confirm receipt
      setPhase('confirming');
      const confirmRes = await fetch(`/api/mcp/approvals/${approvalId}/page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          receiptStatus: 'success',
          txHash,
        }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok || !confirmData.ok) {
        setError(confirmData.error || 'Confirm failed (tx was submitted, polling for status)');
      } else {
        setApproval(confirmData.approval);
      }
      setPhase('confirmed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      setError(msg);
      const a = await fetchApproval();
      if (a) {
        setApproval(a);
        if (a.status === 'submitted') {
          setPhase('submitting');
        } else {
          setPhase('ready');
        }
      } else {
        setPhase('ready');
      }
    }
  }

  // ── Derived state ───────────────────────────────────────────────────

  const isTerminal = phase === 'confirmed' || phase === 'failed' || phase === 'cancelled' || phase === 'expired';
  const isBusy = phase === 'approving' || phase === 'cancelling' || phase === 'executing' || phase === 'submitting' || phase === 'confirming';

  const showApproveBtn = approval?.status === 'awaiting_approval' && (phase === 'ready' || phase === 'approving');
  const showCancelBtn =
    approval &&
    (approval.status === 'awaiting_approval' || approval.status === 'approved') &&
    (phase === 'ready' || phase === 'approving' || phase === 'cancelling');
  const showExecuteBtn = approval?.status === 'approved' && phase === 'ready' && circleAuthenticated;
  const showCircleLogin = approval?.status === 'approved' && phase === 'ready' && !circleAuthenticated;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#050505] px-4 py-12">
      <div className="mx-auto max-w-[520px]">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/profile"
            className="mb-6 inline-flex items-center gap-2 text-[13px] text-[#EAE4D8]/50 transition hover:text-[#F5F0E5]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Profile
          </Link>

          <div className="mt-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#F3C536]/35 bg-[#05070A]">
              <Shield className="h-5 w-5 text-[#F3C536]" />
            </div>
            <div>
              <h1 className="text-[20px] font-semibold tracking-[-0.04em] text-[#F5F0E5]">
                MCP Approval
              </h1>
              <p className="text-[13px] text-[#EAE4D8]/50">
                Review and approve on-chain action
              </p>
            </div>
          </div>
        </div>

        {/* Loading */}
        {phase === 'loading' && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-[#F3C536]" />
          </div>
        )}

        {/* Wallet required */}
        {phase === 'wallet_required' && (
          <div className="rounded-lg border border-white/10 bg-[#07090D]/88 p-7">
            <p className="text-[14px] text-[#F5F0E5]">
              Connect your wallet to view this approval.
            </p>
          </div>
        )}

        {/* Wallet mismatch */}
        {phase === 'wallet_mismatch' && (
          <div className="rounded-lg border border-[#FF6B6B]/20 bg-[#07090D]/88 p-7">
            <div className="flex items-center gap-3">
              <XCircle className="h-5 w-5 text-[#FF6B6B]" />
              <p className="text-[14px] text-[#F5F0E5]">
                This approval belongs to a different wallet.
              </p>
            </div>
          </div>
        )}

        {/* Not found */}
        {phase === 'not_found' && (
          <div className="rounded-lg border border-white/10 bg-[#07090D]/88 p-7">
            <p className="text-[14px] text-[#F5F0E5]">Approval not found.</p>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mb-6 rounded-lg border border-[#FF6B6B]/20 bg-[#FF6B6B]/5 px-5 py-3">
            <p className="text-[13px] text-[#FF6B6B]">{error}</p>
          </div>
        )}

        {/* Approval card */}
        {approval && phase !== 'loading' && phase !== 'wallet_required' && phase !== 'not_found' && (
          <div className="space-y-5">
            {/* Status badge + countdown */}
            <div className="flex items-center justify-between">
              <span
                className={`rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${statusColor(
                  phase === 'ready' ? approval.status : phase as ApprovalStatus,
                )}`}
              >
                {statusLabel(
                  phase === 'ready' ? approval.status : phase as ApprovalStatus,
                )}
              </span>

              {!isTerminal && approval.status !== 'confirmed' && (
                <span className="flex items-center gap-1.5 text-[12px] text-[#EAE4D8]/50">
                  <Clock className="h-3.5 w-3.5" />
                  {countdown}
                </span>
              )}
            </div>

            {/* Action details card */}
            <div className="overflow-hidden rounded-lg border border-white/10 bg-[#07090D]/88 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
              <div className="px-6 py-5">
                <h2 className="mb-1 text-[15px] font-semibold text-[#F5F0E5]">
                  Action Details
                </h2>
                <p className="text-[12px] text-[#EAE4D8]/50">
                  Review the on-chain action before approving
                </p>
              </div>

              <div className="border-t border-white/5 px-6">
                <Field label="Action" value={approval.action} />
                <Field label="Contract" value={shortAddress(approval.toAddress)} mono />
                <Field label="Agent Account" value={shortAddress(approval.agentAccountAddress)} mono />
                <Field label="Owner" value={shortAddress(approval.ownerAddress)} mono />
                <Field
                  label="Value"
                  value={approval.value === '0x0' ? '0 (no value)' : approval.value}
                  mono
                />
                <Field label="Chain ID" value={String(approval.chainId)} />

                {/* Metadata from summary */}
                {approval.summary && typeof approval.summary === 'object' && (() => {
                  const summary = approval.summary as Record<string, unknown>;
                  const metadata = summary.metadata as Record<string, unknown> | undefined;
                  return (
                    <>
                      {metadata?.name && (
                        <Field label="Agent Name" value={String(metadata.name)} />
                      )}
                      {metadata?.role && (
                        <Field label="Role" value={String(metadata.role)} />
                      )}
                      {summary.metadataURI && (
                        <Field label="Metadata URI" value={shortHash(String(summary.metadataURI))} mono />
                      )}
                    </>
                  );
                })()}

                <Field label="Approval ID" value={shortHash(approval.id)} mono />
                <Field label="Created" value={formatDate(approval.createdAt)} />
                <Field label="Expires" value={formatDate(approval.expiresAt)} />

                {approval.approvedAt && (
                  <Field label="Approved" value={formatDate(approval.approvedAt)} />
                )}
                {approval.txHash && (
                  <Field label="Tx Hash" value={shortHash(approval.txHash)} mono />
                )}
                {approval.submittedAt && (
                  <Field label="Submitted" value={formatDate(approval.submittedAt)} />
                )}
                {approval.confirmedAt && (
                  <Field label="Confirmed" value={formatDate(approval.confirmedAt)} />
                )}
                {approval.error && (
                  <Field
                    label="Error"
                    value={<span className="text-[#FF6B6B]">{approval.error}</span>}
                  />
                )}
              </div>
            </div>

            {/* Calldata preview */}
            <details className="overflow-hidden rounded-lg border border-white/10 bg-[#07090D]/88">
              <summary className="cursor-pointer px-6 py-4 text-[13px] font-medium text-[#EAE4D8]/60 transition hover:text-[#F5F0E5]">
                Calldata (advanced)
              </summary>
              <div className="border-t border-white/5 px-6 py-4">
                <pre className="overflow-x-auto font-mono text-[11px] leading-5 text-[#EAE4D8]/50">
                  {approval.data}
                </pre>
              </div>
            </details>

            {/* Transaction link */}
            {approval.txHash && (
              <a
                href={`https://testnet.arcscan.app/tx/${approval.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[13px] text-[#F3C536] transition hover:text-[#F3C536]/80"
              >
                View on ArcScan
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}

            {/* Security notice */}
            {showExecuteBtn && (
              <div className="rounded-lg border border-[#F3C536]/10 bg-[#F3C536]/[0.03] px-5 py-4">
                <div className="flex items-start gap-3">
                  <Shield className="mt-0.5 h-4 w-4 shrink-0 text-[#F3C536]" />
                  <div className="text-[12px] leading-5 text-[#EAE4D8]/60">
                    <p className="font-medium text-[#F3C536]">Security Note</p>
                    <p className="mt-1">
                      Transaction will be signed by your Circle Agent Account via passkey.
                      No private key is exposed. No backend signing occurs.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-3 pt-2">
              {/* Approve + Cancel */}
              {showApproveBtn && (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={phase !== 'ready'}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-md border border-[#F3C536]/40 bg-[#F3C536]/10 text-[13px] font-medium text-[#F3C536] transition hover:bg-[#F3C536]/20 disabled:opacity-50"
                  >
                    {phase === 'approving' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={phase !== 'ready'}
                    className="flex h-12 flex-1 items-center justify-center gap-2 rounded-md border border-white/10 bg-transparent text-[13px] font-medium text-[#EAE4D8]/60 transition hover:border-[#FF6B6B]/30 hover:text-[#FF6B6B] disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                    Cancel
                  </button>
                </div>
              )}

              {/* Cancel only (when approved) */}
              {showCancelBtn && approval.status === 'approved' && !showApproveBtn && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isBusy}
                  className="flex h-12 items-center justify-center gap-2 rounded-md border border-white/10 bg-transparent text-[13px] font-medium text-[#EAE4D8]/60 transition hover:border-[#FF6B6B]/30 hover:text-[#FF6B6B] disabled:opacity-50"
                >
                  {phase === 'cancelling' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                  Cancel Approval
                </button>
              )}

              {/* Execute transaction */}
              {showExecuteBtn && (
                <button
                  type="button"
                  onClick={handleExecute}
                  disabled={isBusy}
                  className="flex h-12 items-center justify-center gap-2 rounded-md border border-[#F3C536]/40 bg-[#F3C536]/10 text-[13px] font-medium text-[#F3C536] transition hover:bg-[#F3C536]/20 disabled:opacity-50"
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {phase === 'executing'
                        ? 'Signing with Passkey…'
                        : phase === 'submitting'
                          ? 'Submitting Tx…'
                          : 'Confirming…'}
                    </>
                  ) : (
                    <>
                      <Shield className="h-4 w-4" />
                      Execute Transaction
                    </>
                  )}
                </button>
              )}

              {/* Circle not connected */}
              {showCircleLogin && (
                <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-5 py-4">
                  <p className="mb-3 text-[13px] text-[#EAE4D8]/60">
                    Login with your Circle Agent Account passkey to execute this transaction.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await circleLogin();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Passkey login failed');
                      }
                    }}
                    className="flex h-11 items-center justify-center gap-2 rounded-md border border-[#F3C536]/40 bg-[#F3C536]/10 px-6 text-[12px] font-medium text-[#F3C536] transition hover:bg-[#F3C536]/20"
                  >
                    <Shield className="h-4 w-4" />
                    Login with Passkey
                  </button>
                </div>
              )}

              {/* Terminal states */}
              {phase === 'confirmed' && (
                <div className="rounded-lg border border-[#B8CD7E]/20 bg-[#B8CD7E]/5 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <Check className="h-5 w-5 text-[#B8CD7E]" />
                    <div>
                      <p className="text-[14px] font-medium text-[#B8CD7E]">
                        Transaction Confirmed
                      </p>
                      <p className="mt-1 text-[12px] text-[#EAE4D8]/50">
                        The on-chain action has been executed successfully.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {phase === 'failed' && (
                <div className="rounded-lg border border-[#FF6B6B]/20 bg-[#FF6B6B]/5 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <XCircle className="h-5 w-5 text-[#FF6B6B]" />
                    <div>
                      <p className="text-[14px] font-medium text-[#FF6B6B]">
                        Transaction Failed
                      </p>
                      <p className="mt-1 text-[12px] text-[#EAE4D8]/50">
                        {approval.error || 'The transaction was reverted on-chain.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {phase === 'cancelled' && (
                <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-5 py-4">
                  <p className="text-[14px] text-[#EAE4D8]/60">
                    This approval has been cancelled.
                  </p>
                </div>
              )}

              {phase === 'expired' && (
                <div className="rounded-lg border border-[#FF6B6B]/20 bg-[#FF6B6B]/5 px-5 py-4">
                  <p className="text-[14px] text-[#FF6B6B]">
                    This approval has expired. The MCP session will need to create a new one.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
