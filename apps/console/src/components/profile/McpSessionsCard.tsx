'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, RefreshCcw, ShieldOff } from 'lucide-react';
import { useSignMessage } from 'wagmi';

type McpSession = {
  id: string;
  status: 'active' | 'expired' | 'revoked' | string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
};

type SessionListResponse = {
  ok: boolean;
  sessions?: McpSession[];
  error?: string;
  detail?: string;
};

function shortId(value: string) {
  if (value.length < 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatDate(value?: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

function statusClass(status: string) {
  if (status === 'active') return 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200';
  if (status === 'revoked') return 'border-rose-400/20 bg-rose-400/[0.06] text-rose-200';
  return 'border-amber-400/20 bg-amber-400/[0.06] text-amber-200';
}

export function McpSessionsCard({ address }: { address: string }) {
  const { signMessageAsync } = useSignMessage();
  const [sessions, setSessions] = useState<McpSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [signing, setSigning] = useState(false);
  const [revokingId, setRevokingId] = useState('');
  const [error, setError] = useState('');

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/mcp/sessions/list', { cache: 'no-store' });
      const data = (await res.json()) as SessionListResponse;

      if (res.status === 401) {
        setAuthRequired(true);
        setSessions([]);
        return;
      }

      if (!res.ok || !data.ok) {
        setError(data.detail || data.error || 'Failed to load MCP sessions.');
        return;
      }

      setAuthRequired(false);
      setSessions(data.sessions || []);
    } catch {
      setError('Network error while loading MCP sessions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSessions([]);
    void loadSessions();
  }, [loadSessions, address]);

  const signAndLoad = useCallback(async () => {
    setSigning(true);
    setError('');

    try {
      const { ensureWalletSession } = await import('@/lib/auth/ensureWalletSession');
      const result = await ensureWalletSession(address, signMessageAsync);
      if (!result.ok) {
        setError(result.error || 'Wallet session required.');
        return;
      }
      await loadSessions();
    } catch {
      setError('Wallet signing was cancelled or failed.');
    } finally {
      setSigning(false);
    }
  }, [address, loadSessions, signMessageAsync]);

  const revokeSession = useCallback(async (sessionId: string) => {
    setRevokingId(sessionId);
    setError('');

    try {
      const res = await fetch('/api/mcp/sessions/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; detail?: string };

      if (res.status === 401) {
        setAuthRequired(true);
        return;
      }

      if (!res.ok || !data.ok) {
        setError(data.detail || data.error || 'Failed to revoke MCP session.');
        return;
      }

      await loadSessions();
    } catch {
      setError('Network error while revoking MCP session.');
    } finally {
      setRevokingId('');
    }
  }, [loadSessions]);

  return (
    <div id="mcp-sessions" className="rounded-lg border border-white/10 bg-[#07090D]/88 p-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">MCP Sessions</div>
          <p className="mt-2 max-w-2xl text-[13px] leading-5 text-[#EAE4D8]/55">Manage MCP sessions connected to your ArcLayer wallet. Sessions are valid for 30 days and can be revoked anytime.</p>
        </div>
        {!authRequired && (
          <button type="button" onClick={loadSessions} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-4 text-[12px] text-[#EAE4D8]/60 transition hover:border-[#F3C536]/35 hover:text-[#F3C536] disabled:opacity-40">
            <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      {authRequired && (
        <div className="mt-5 rounded-md border border-[#F3C536]/20 bg-[#F3C536]/[0.04] p-4">
          <p className="text-[12px] text-[#EAE4D8]/60">Sign with your connected wallet to load and manage MCP sessions.</p>
          <button type="button" onClick={signAndLoad} disabled={signing} className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-[#F3C536] px-4 text-[12px] font-semibold text-black transition hover:bg-[#F3C536]/90 disabled:opacity-40">
            {signing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            Sign to load sessions
          </button>
        </div>
      )}

      {error && <div className="mt-4 rounded-md border border-rose-400/25 bg-rose-400/[0.055] px-4 py-3 text-[12px] text-rose-200">{error}</div>}

      {!authRequired && !loading && sessions.length === 0 && (
        <p className="mt-5 text-[13px] text-[#EAE4D8]/45">No MCP sessions found for this wallet.</p>
      )}

      {!authRequired && sessions.length > 0 && (
        <div className="mt-5 space-y-3">
          {sessions.map((session) => (
            <div key={session.id} className="rounded-md border border-white/[0.08] bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-[#F5F0E5]">{shortId(session.id)}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] ${statusClass(session.status)}`}>{session.status}</span>
                  </div>
                  <div className="mt-3 grid gap-1 text-[11px] text-[#EAE4D8]/45 sm:grid-cols-2 sm:gap-x-8">
                    <span>Created {formatDate(session.createdAt)}</span>
                    <span>Expires {formatDate(session.expiresAt)}</span>
                    <span>Last used {formatDate(session.lastUsedAt)}</span>
                  </div>
                </div>
                {session.status === 'active' && (
                  <button type="button" onClick={() => revokeSession(session.id)} disabled={revokingId === session.id} className="inline-flex h-9 items-center gap-2 rounded-md border border-rose-400/25 px-4 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-400/10 disabled:opacity-40">
                    {revokingId === session.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="h-3.5 w-3.5" />}
                    Revoke Session
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
