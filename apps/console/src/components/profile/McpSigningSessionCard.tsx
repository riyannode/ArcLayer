'use client';

/**
 * McpSigningSessionCard — Compact card for /profile page.
 *
 * Shows MCP signing session state + polling for pending requests.
 * Matches existing profile design tokens exactly.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clipboard, KeyRound, Loader2, RefreshCcw, Wifi, X } from 'lucide-react';
import { useSignMessage } from 'wagmi';
import { SigningRequestModal } from './SigningRequestModal';

// ── Types ─────────────────────────────────────────────────────────────────

type SessionInfo = {
  id: string;
  pairingCode: string;
  ownerWallet: string;
  status: string;
  expiresAt: string;
  createdAt: string;
};

type PendingRequest = {
  id: string;
  sessionId: string;
  actionType: string;
  chainId: number;
  expectedClientWallet: string;
  transactions: Array<{
    kind: string;
    to: string;
    data: string;
    value: string;
    summary?: string;
  }>;
  summary: Record<string, unknown> | null;
  status: string;
  expiresAt: string;
  createdAt: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────

function shortAddr(value?: string) {
  if (!value) return '—';
  if (value.length < 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function copyToClipboard(value?: string) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
}

// ── Component ─────────────────────────────────────────────────────────────

export function McpSigningSessionCard({ address }: { address?: string }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [activeRequest, setActiveRequest] = useState<PendingRequest | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { signMessageAsync } = useSignMessage();

  // ── Ensure wallet session before authenticated calls ──────────────────

  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (!address) return false;
    try {
      const { ensureWalletSession } = await import('@/lib/auth/ensureWalletSession');
      const result = await ensureWalletSession(address, signMessageAsync);
      return result.ok;
    } catch {
      return false;
    }
  }, [address, signMessageAsync]);

  // ── Create session ────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const ok = await ensureSession();
      if (!ok) {
        setError('Wallet session required. Please sign the message.');
        return;
      }

      const res = await fetch('/api/mcp/signing-sessions', { method: 'POST' });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Failed to create session');
        return;
      }
      setSession(data.session);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [ensureSession]);

  // ── Revoke session ────────────────────────────────────────────────────

  const handleRevoke = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/mcp/signing-sessions/${session.id}/revoke`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.ok) {
        setSession((prev) => prev ? { ...prev, status: 'revoked' } : null);
        setPendingRequests([]);
      } else {
        setError(data.error || 'Failed to revoke');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [session]);

  // ── Poll pending requests ─────────────────────────────────────────────

  const pollPending = useCallback(async () => {
    if (!session || session.status !== 'active') return;
    try {
      const res = await fetch(
        `/api/mcp/signing-requests/pending?sessionId=${session.id}`,
      );
      const data = await res.json();
      if (data.ok && Array.isArray(data.requests)) {
        setPendingRequests(data.requests);
      }
    } catch {
      // Non-blocking
    }
  }, [session]);

  // ── Heartbeat ─────────────────────────────────────────────────────────

  const sendHeartbeat = useCallback(async () => {
    if (!session || session.status !== 'active') return;
    try {
      await fetch(`/api/mcp/signing-sessions/${session.id}/heartbeat`, {
        method: 'POST',
      });
    } catch {
      // Non-blocking
    }
  }, [session]);

  // ── Start/stop polling when session is active ─────────────────────────

  useEffect(() => {
    if (!session || session.status !== 'active') {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      pollingRef.current = null;
      heartbeatRef.current = null;
      return;
    }

    // Poll every 2s
    pollPending();
    pollingRef.current = setInterval(pollPending, 2000);

    // Heartbeat every 5 minutes
    heartbeatRef.current = setInterval(sendHeartbeat, 5 * 60 * 1000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [session, pollPending, sendHeartbeat]);

  // ── Restore session from list on mount ────────────────────────────────

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    async function loadExisting() {
      try {
        const res = await fetch('/api/mcp/signing-sessions');
        const data = await res.json();
        if (!cancelled && data.ok && data.sessions?.length > 0) {
          const active = data.sessions.find((s: SessionInfo) => s.status === 'active');
          if (active) setSession(active);
        }
      } catch {
        // Non-blocking
      }
    }

    void loadExisting();
    return () => { cancelled = true; };
  }, [address]);

  // ── Handle request completion ─────────────────────────────────────────

  const handleRequestDone = useCallback(() => {
    setActiveRequest(null);
    setDismissedIds(new Set());
    void pollPending();
  }, [pollPending]);

  // Dismiss a request (user closed modal without approving)
  const handleDismiss = useCallback((requestId: string) => {
    setActiveRequest(null);
    setDismissedIds((prev) => new Set(prev).add(requestId));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────

  const isActive = session?.status === 'active';
  const isExpired = session?.status === 'expired';
  const isRevoked = session?.status === 'revoked';

  return (
    <>
      <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
          MCP Client Signing Session
        </div>

        {/* Owner wallet */}
        <div className="mt-4 grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/[0.06] py-3">
          <div className="text-[13px] text-[#EAE4D8]/60">Owner Wallet</div>
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[13px] text-[#F5F0E5]">
              {shortAddr(address)}
            </span>
            {address && (
              <button
                type="button"
                onClick={() => copyToClipboard(address)}
                className="text-[#EAE4D8]/45 transition hover:text-[#F3C536]"
              >
                <Clipboard className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Session status */}
        {session ? (
          <>
            {/* Session ID */}
            <div className="grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/[0.06] py-3">
              <div className="text-[13px] text-[#EAE4D8]/60">Session ID</div>
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-[12px] text-[#EAE4D8]/70">
                  {session.id.slice(0, 8)}...
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(session.id)}
                  className="text-[#EAE4D8]/45 transition hover:text-[#F3C536]"
                  aria-label="Copy session ID"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Pairing Code */}
            <div className="grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/[0.06] py-3">
              <div className="text-[13px] text-[#EAE4D8]/60">Pairing Code</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[14px] tracking-[0.12em] text-[#F3C536]">
                  {session.pairingCode}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(session.pairingCode)}
                  className="text-[#EAE4D8]/45 transition hover:text-[#F3C536]"
                  aria-label="Copy pairing code"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Status */}
            <div className="grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/[0.06] py-3">
              <div className="text-[13px] text-[#EAE4D8]/60">Status</div>
              <div className="flex items-center gap-2">
                {isActive && (
                  <span className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                    Active
                  </span>
                )}
                {isExpired && (
                  <span className="rounded-md border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                    Expired
                  </span>
                )}
                {isRevoked && (
                  <span className="rounded-md border border-rose-400/20 bg-rose-400/10 px-2 py-0.5 font-mono text-[10px] text-rose-300">
                    Revoked
                  </span>
                )}
                {isActive && (
                  <span className="ml-auto flex items-center gap-1.5 text-[11px] text-emerald-300/60">
                    <Wifi className="h-3 w-3" />
                    Polling
                  </span>
                )}
              </div>
            </div>

            {/* Pending requests indicator */}
            {isActive && pendingRequests.length > 0 && (
              <div className="mt-4 rounded-md border border-[#F3C536]/25 bg-[#F3C536]/[0.06] px-4 py-3">
                <div className="flex items-center gap-2 text-[13px] text-[#F3C536]">
                  <KeyRound className="h-4 w-4" />
                  {pendingRequests.length} pending signing request{pendingRequests.length > 1 ? 's' : ''}
                </div>
                <p className="mt-1 text-[12px] text-[#EAE4D8]/50">
                  Approve or reject in the modal below.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="mt-5 flex items-center gap-3">
              {isActive && (
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={loading}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-rose-400/30 bg-transparent px-5 text-[12px] font-medium text-rose-300 transition hover:bg-rose-400/10 disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" />
                  Revoke Session
                </button>
              )}

              {(isExpired || isRevoked) && (
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={loading}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-black transition hover:bg-[#F3C536]/90 disabled:opacity-40"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-3.5 w-3.5" />
                  )}
                  Start New Session
                </button>
              )}
            </div>
          </>
        ) : (
          /* No session — show create button */
          <div className="mt-5">
            <p className="text-[13px] text-[#EAE4D8]/55">
              Start a signing session to allow MCP to request transactions
              that you approve in this browser.
            </p>
            <button
              type="button"
              onClick={handleCreate}
              disabled={loading}
              className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-black transition hover:bg-[#F3C536]/90 disabled:opacity-40"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="h-3.5 w-3.5" />
              )}
              Start MCP Signing Session
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-md border border-rose-400/25 bg-rose-400/[0.055] px-4 py-3 text-[12px] text-rose-200">
            {error}
          </div>
        )}
      </div>

      {/* Signing Request Modal */}
      {activeRequest && (
        <SigningRequestModal
          request={activeRequest}
          address={address}
          onClose={() => setActiveRequest(null)}
          onDone={handleRequestDone}
        />
      )}

      {/* Auto-open modal when pending request arrives (not dismissed) */}
      {(() => {
        const undismissed = pendingRequests.find((r) => !dismissedIds.has(r.id));
        if (!undismissed || activeRequest) return null;
        return (
          <SigningRequestModal
            request={undismissed}
            address={address}
            onClose={() => handleDismiss(undismissed.id)}
            onDone={handleRequestDone}
          />
        );
      })()}
    </>
  );
}
