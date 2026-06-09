'use client';

/**
 * SigningRequestModal — Approve/reject modal for MCP signing requests.
 *
 * Uses walletClient.sendTransaction for raw tx instructions (NOT writeContractAsync).
 * Sends transactions sequentially, waits receipt for each.
 * Parses JobCreated event for createJob tx.
 */

import { useCallback, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react';
import { useWalletClient, useAccount, usePublicClient, useSwitchChain } from 'wagmi';
import { decodeEventLog, type Hex } from 'viem';
import { ERC8183_AGENTIC_COMMERCE_ABI, CONTRACTS } from '@arclayer/sdk';
import { selectorLabel } from '@/lib/mcp/signing-bridge/whitelist';
import type { SigningTransaction } from '@/lib/mcp/signing-bridge/whitelist';

// ── Types ─────────────────────────────────────────────────────────────────

type PendingRequest = {
  id: string;
  sessionId: string;
  actionType: string;
  chainId: number;
  expectedClientWallet: string;
  transactions: SigningTransaction[];
  summary: Record<string, unknown> | null;
  status: string;
  expiresAt: string;
  createdAt: string;
};

type TxReceipt = {
  txHash: string;
  blockNumber: string;
  gasUsed: string;
};

type ModalPhase =
  | 'confirm'
  | 'claiming'
  | 'signing'
  | 'submitting'
  | 'confirming'
  | 'done'
  | 'error'
  | 'rejected';

// ── Helpers ───────────────────────────────────────────────────────────────

function shortAddr(value?: string) {
  if (!value) return '—';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function txLink(hash: string) {
  return `https://testnet.arcscan.app/tx/${hash}`;
}

// ── Component ─────────────────────────────────────────────────────────────

export function SigningRequestModal({
  request,
  address,
  onClose,
  onDone,
}: {
  request: PendingRequest;
  address?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: walletClient } = useWalletClient();
  const { address: connectedAddress, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();

  const [phase, setPhase] = useState<ModalPhase>('confirm');
  const [error, setError] = useState('');
  const [txHashes, setTxHashes] = useState<string[]>([]);
  const [receipts, setReceipts] = useState<TxReceipt[]>([]);
  const [jobId, setJobId] = useState<string | undefined>();
  const [currentTxIndex, setCurrentTxIndex] = useState(0);

  // ── Approve flow ──────────────────────────────────────────────────────

  const handleApprove = useCallback(async () => {
    if (!walletClient || !connectedAddress) {
      setError('Wallet not connected');
      setPhase('error');
      return;
    }

    if (chainId !== request.chainId) {
      try {
        const switchedChain = await switchChainAsync({ chainId: request.chainId });
        if (switchedChain.id !== request.chainId) {
          throw new Error('switchChain returned wrong chain');
        }
      } catch {
        setError('Wrong network. Switch wallet to Arc Testnet before signing.');
        setPhase('error');
        return;
      }
    }

    // 1. Atomic claim
    setPhase('claiming');
    try {
      const claimRes = await fetch(`/api/mcp/signing-requests/${request.id}/claim`, {
        method: 'POST',
      });
      const claimData = await claimRes.json();
      if (!claimData.ok) {
        setError(claimData.detail || claimData.error || 'Claim failed');
        setPhase('error');
        return;
      }
    } catch {
      setError('Failed to claim request');
      setPhase('error');
      return;
    }

    // 2. Send transactions sequentially
    setPhase('signing');
    const collectedHashes: string[] = [];
    const collectedReceipts: TxReceipt[] = [];
    let parsedJobId: string | undefined;

    for (let i = 0; i < request.transactions.length; i++) {
      setCurrentTxIndex(i);
      const tx = request.transactions[i];

      try {
        // walletClient.sendTransaction for raw tx instructions
        const hash = await walletClient.sendTransaction({
          account: connectedAddress,
          to: tx.to as Hex,
          data: tx.data as Hex,
          value: BigInt(tx.value || '0'),
        });

        collectedHashes.push(hash);

        // Wait for receipt
        setPhase('submitting');
        const receipt = await publicClient!.waitForTransactionReceipt({ hash });

        collectedReceipts.push({
          txHash: hash,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
        });

        // Parse JobCreated event if this is a createJob tx
        if (
          tx.kind === 'erc8183_create_job' &&
          receipt.status === 'success'
        ) {
          for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== CONTRACTS.ERC8183_AGENTIC_COMMERCE.toLowerCase()) continue;
            try {
              const decoded = decodeEventLog({
                abi: ERC8183_AGENTIC_COMMERCE_ABI,
                data: log.data,
                topics: log.topics,
              });
              if (decoded.eventName === 'JobCreated' && decoded.args && 'jobId' in decoded.args) {
                parsedJobId = (decoded.args.jobId as bigint).toString();
                break;
              }
            } catch {
              // skip non-matching logs
            }
          }
        }
      } catch (err) {
        setError(
          `Transaction ${i + 1} failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
        setPhase('error');

        // Mark as submitted with partial results if we have any hashes
        if (collectedHashes.length > 0) {
          await fetch(`/api/mcp/signing-requests/${request.id}/submitted`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txHash: collectedHashes[0] }),
          }).catch(() => {});
        }
        return;
      }
    }

    setTxHashes(collectedHashes);
    setReceipts(collectedReceipts);
    if (parsedJobId) setJobId(parsedJobId);

    // 3. Mark submitted
    try {
      await fetch(`/api/mcp/signing-requests/${request.id}/submitted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: collectedHashes[0] }),
      });
    } catch {
      // Non-blocking — confirmed step will also update
    }

    // 4. Mark confirmed with full result
    setPhase('confirming');
    try {
      const result: Record<string, unknown> = {
        txHashes: collectedHashes,
        receipts: collectedReceipts,
      };
      if (parsedJobId) result.jobId = parsedJobId;

      await fetch(`/api/mcp/signing-requests/${request.id}/confirmed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result }),
      });
    } catch {
      // Non-blocking
    }

    setPhase('done');
  }, [walletClient, connectedAddress, chainId, switchChainAsync, request]);

  // ── Reject flow ───────────────────────────────────────────────────────

  const handleReject = useCallback(async () => {
    try {
      await fetch(`/api/mcp/signing-requests/${request.id}/cancel`, {
        method: 'POST',
      });
    } catch {
      // Non-blocking
    }
    setPhase('rejected');
  }, [request.id]);

  // ── Close handler ─────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (phase === 'done' || phase === 'rejected' || phase === 'error') {
      onDone();
    } else {
      onClose();
    }
  }, [phase, onClose, onDone]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-lg border border-white/10 bg-[#0B0F14] p-6 shadow-2xl">
        {/* Close button */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 text-[#EAE4D8]/45 transition hover:text-[#F3C536]"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Title */}
        <h2 className="text-[18px] font-semibold text-[#F5F0E5]">
          Signing Request
        </h2>
        <p className="mt-1 text-[13px] text-[#EAE4D8]/55">
          Action: {request.actionType.replace(/_/g, ' ')}
        </p>

        {/* Transactions list */}
        <div className="mt-5 space-y-3">
          {request.transactions.map((tx, i) => {
            const selector = tx.data.slice(0, 10).toLowerCase();
            const label = selectorLabel(tx.to, selector);
            const isActive = phase === 'signing' && i === currentTxIndex;

            return (
              <div
                key={i}
                className={`rounded-md border px-4 py-3 ${
                  isActive
                    ? 'border-[#F3C536]/40 bg-[#F3C536]/[0.06]'
                    : 'border-white/10 bg-white/[0.025]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-medium text-[#F5F0E5]">
                    {tx.summary || label}
                  </div>
                  <span className="font-mono text-[10px] text-[#EAE4D8]/40">
                    {tx.kind}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[12px] text-[#EAE4D8]/55">
                  <span>→ {shortAddr(tx.to)}</span>
                  <span className="text-[#EAE4D8]/30">|</span>
                  <span className="font-mono text-[11px]">{label}</span>
                </div>
                {txHashes[i] && (
                  <div className="mt-2 flex items-center gap-1.5 text-[12px]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    <a
                      href={txLink(txHashes[i])}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-300/70 transition hover:text-emerald-300"
                    >
                      {shortAddr(txHashes[i])}
                    </a>
                    <ExternalLink className="h-3 w-3 text-emerald-400/50" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Summary info */}
        {request.summary && (
          <div className="mt-4 rounded-md border border-white/10 bg-white/[0.018] px-4 py-3">
            {Object.entries(request.summary).map(([key, value]) => {
              if (!value || key === 'actionType') return null;
              return (
                <div key={key} className="flex items-center justify-between py-1">
                  <span className="text-[12px] text-[#EAE4D8]/50">
                    {key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
                  </span>
                  <span className="font-mono text-[12px] text-[#F5F0E5]/70">
                    {String(value).length > 20
                      ? `${String(value).slice(0, 10)}...${String(value).slice(-6)}`
                      : String(value)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Job ID (for createJob) */}
        {jobId && phase === 'done' && (
          <div className="mt-4 rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3">
            <div className="text-[12px] text-emerald-300/70">Job Created</div>
            <div className="mt-1 font-mono text-[14px] text-emerald-200">
              #{jobId}
            </div>
          </div>
        )}

        {/* Phase indicator */}
        {phase === 'claiming' && (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-[#F3C536]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Claiming request...
          </div>
        )}
        {phase === 'signing' && (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-[#F3C536]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Waiting for wallet signature (tx {currentTxIndex + 1}/{request.transactions.length})...
          </div>
        )}
        {phase === 'submitting' && (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-[#F3C536]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Waiting for confirmation...
          </div>
        )}
        {phase === 'confirming' && (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-emerald-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            Recording result...
          </div>
        )}

        {/* Done */}
        {phase === 'done' && (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            All transactions confirmed.
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-400/25 bg-rose-400/[0.055] px-4 py-3 text-[12px] text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Rejected */}
        {phase === 'rejected' && (
          <div className="mt-4 text-[13px] text-rose-300">
            Request rejected.
          </div>
        )}

        {/* Actions */}
        {phase === 'confirm' && (
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={handleApprove}
              disabled={!walletClient}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-black transition hover:bg-[#F3C536]/90 disabled:opacity-40"
            >
              Approve & Sign
            </button>
            <button
              type="button"
              onClick={handleReject}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-transparent px-5 text-[12px] font-medium text-[#EAE4D8]/70 transition hover:border-rose-400/30 hover:text-rose-300"
            >
              Reject
            </button>
          </div>
        )}

        {/* Done/Dismiss */}
        {(phase === 'done' || phase === 'error' || phase === 'rejected') && (
          <div className="mt-6">
            <button
              type="button"
              onClick={handleClose}
              className="inline-flex h-10 w-full items-center justify-center rounded-md border border-white/10 bg-transparent px-5 text-[12px] font-medium text-[#EAE4D8]/70 transition hover:border-[#F3C536]/30 hover:text-[#F3C536]"
            >
              Close
            </button>
          </div>
        )}

        {/* Wallet not connected warning */}
        {!walletClient && phase === 'confirm' && (
          <div className="mt-3 text-center text-[12px] text-rose-300/70">
            Connect your wallet to approve this request.
          </div>
        )}
      </div>
    </div>
  );
}
