'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Clipboard, KeyRound, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { useSignMessage } from 'wagmi';
import {
  buildBashCodexSetup,
  buildPowerShellCodexSetup,
} from '@/lib/mcp/codex-setup-command';

type McpSessionCreateResponse = {
  ok: boolean;
  token?: string;
  session?: {
    id: string;
    ownerAddress: string;
    agentAccountAddress: string;
    controllerAddress?: string;
    signerAddress?: string;
    mode?: 'eoa' | 'agent-account';
    permissions: unknown;
    autoApprove: boolean;
    expiresAt: string;
    createdAt: string;
  };
  claudeConfig?: {
    ARCLAYER_MCP_URL: string;
    ARCLAYER_MCP_TOKEN: string;
    MCP_TRANSPORT: string;
  };
  warning?: string;
  error?: string;
  detail?: string;
};

type McpSessionListItem = {
  id: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type McpSessionListResponse = {
  ok: boolean;
  sessions?: McpSessionListItem[];
  error?: string;
  detail?: string;
};

function shortAddr(value?: string) {
  if (!value) return '—';
  if (value.length < 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatDate(value?: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

async function copyToClipboard(value: string) {
  await navigator.clipboard.writeText(value);
}

export function AgentIdentityMcpSessionCard({
  ownerAddress,
}: {
  ownerAddress?: string;
}) {
  const { signMessageAsync } = useSignMessage();

  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<McpSessionCreateResponse | null>(null);
  const [activeSessions, setActiveSessions] = useState<McpSessionListItem[]>([]);
  const [setupShell, setSetupShell] = useState<'powershell' | 'bash'>('powershell');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState('');
  const [error, setError] = useState('');
  const [sessionsError, setSessionsError] = useState('');

  const setupCommand = useMemo(() => {
    if (!result?.claudeConfig) return '';
    return setupShell === 'powershell'
      ? buildPowerShellCodexSetup(result.claudeConfig)
      : buildBashCodexSetup(result.claudeConfig);
  }, [result, setupShell]);

  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (!ownerAddress) return false;

    try {
      const { ensureWalletSession } = await import('@/lib/auth/ensureWalletSession');
      const session = await ensureWalletSession(ownerAddress, signMessageAsync);
      return session.ok;
    } catch {
      return false;
    }
  }, [ownerAddress, signMessageAsync]);

  const loadSessions = useCallback(async () => {
    if (!ownerAddress) {
      setActiveSessions([]);
      return;
    }

    setSessionsLoading(true);
    setSessionsError('');

    try {
      const res = await fetch('/api/mcp/sessions/list', { cache: 'no-store' });
      const data = (await res.json()) as McpSessionListResponse;

      if (!res.ok || !data.ok) {
        setActiveSessions([]);
        if (res.status !== 401) {
          setSessionsError(data.detail || data.error || 'Failed to load Codex sessions.');
        }
        return;
      }

      setActiveSessions((data.sessions || []).filter((session) => session.status === 'active'));
    } catch {
      setSessionsError('Network error while loading Codex sessions.');
    } finally {
      setSessionsLoading(false);
    }
  }, [ownerAddress]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const handleCreate = useCallback(async () => {
    setError('');
    setResult(null);
    setCopied(false);

    if (!ownerAddress) {
      setError('Connect wallet first.');
      return;
    }

    setLoading(true);

    try {
      const hasWalletSession = await ensureSession();

      if (!hasWalletSession) {
        setError('Wallet session required. Please sign the message.');
        return;
      }

      const res = await fetch('/api/mcp/sessions/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'eoa' }),
      });
      const data = (await res.json()) as McpSessionCreateResponse;

      if (!res.ok || !data.ok) {
        setError(data.detail || data.error || 'Failed to connect Codex.');
        return;
      }

      setResult(data);
      await loadSessions();
    } catch {
      setError('Network error while connecting Codex.');
    } finally {
      setLoading(false);
    }
  }, [ensureSession, loadSessions, ownerAddress]);

  const handleRevoke = useCallback(async (sessionId: string) => {
    if (!sessionId) return;

    setError('');
    setRevokingSessionId(sessionId);

    try {
      const hasWalletSession = await ensureSession();
      if (!hasWalletSession) {
        setError('Wallet session required. Please sign the message.');
        return;
      }

      const res = await fetch('/api/mcp/sessions/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; detail?: string };

      if (!res.ok || !data.ok) {
        setError(data.detail || data.error || 'Failed to disconnect Codex.');
        return;
      }

      if (result?.session?.id === sessionId) {
        setResult(null);
        setCopied(false);
      }
      await loadSessions();
    } catch {
      setError('Network error while disconnecting Codex.');
    } finally {
      setRevokingSessionId('');
    }
  }, [ensureSession, loadSessions, result?.session?.id]);

  const handleCopy = useCallback(async () => {
    if (!setupCommand) return;

    await copyToClipboard(setupCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [setupCommand]);

  return (
    <div className="rounded-lg border border-white/10 bg-[#07090D]/88 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/[0.025]"
      >
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
            Codex Auth Session
          </div>
          <div className="mt-1 text-[12px] text-[#EAE4D8]/45">
            Connect Codex to ArcLayer using the connected wallet.
          </div>
        </div>

        <div className="text-[#F3C536]">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] px-5 pb-5 pt-1">
          <div className="mt-3 grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/[0.06] py-3">
            <div className="text-[13px] text-[#EAE4D8]/60">Owner Wallet</div>
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-[13px] text-[#F5F0E5]">
                {shortAddr(ownerAddress)}
              </span>
              {ownerAddress && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(ownerAddress)}
                  className="text-[#EAE4D8]/45 transition hover:text-[#F3C536]"
                  aria-label="Copy owner wallet"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleCreate}
              disabled={loading || !ownerAddress}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-black transition hover:bg-[#F3C536]/90 disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              Connect Codex
            </button>
            <span className="text-[11px] text-[#EAE4D8]/40">Valid for 30 days. Reconnect anytime after expiry.</span>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-rose-400/25 bg-rose-400/[0.055] px-4 py-3 text-[12px] text-rose-200">
              {error}
            </div>
          )}

          {result?.session && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-400/20 bg-emerald-400/[0.055] px-4 py-3">
              <div>
                <div className="text-[12px] font-semibold text-emerald-200">Connected</div>
                <div className="mt-1 text-[11px] text-[#EAE4D8]/50">Valid until {formatDate(result.session.expiresAt)}</div>
              </div>
              <button
                type="button"
                onClick={() => handleRevoke(result.session?.id || '')}
                disabled={revokingSessionId === result.session.id}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-rose-400/25 px-3 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-400/10 disabled:opacity-40"
              >
                {revokingSessionId === result.session.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                Disconnect Codex
              </button>
            </div>
          )}

          {result?.claudeConfig && (
            <div className="mt-5 rounded-md border border-[#F3C536]/20 bg-black/35 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#F3C536]">Codex Connection</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSetupShell('powershell')}
                  className={setupShell === 'powershell' ? 'rounded-md bg-[#F3C536] px-3 py-2 text-[11px] font-semibold text-black' : 'rounded-md border border-white/10 px-3 py-2 text-[11px] text-[#EAE4D8]/60 hover:border-[#F3C536]/30'}
                >
                  Windows PowerShell
                </button>
                <button
                  type="button"
                  onClick={() => setSetupShell('bash')}
                  className={setupShell === 'bash' ? 'rounded-md bg-[#F3C536] px-3 py-2 text-[11px] font-semibold text-black' : 'rounded-md border border-white/10 px-3 py-2 text-[11px] text-[#EAE4D8]/60 hover:border-[#F3C536]/30'}
                >
                  macOS/Linux Bash
                </button>
              </div>

              <pre className="mt-3 max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-md border border-white/[0.06] bg-black/35 p-3 font-mono text-[11px] leading-5 text-[#EAE4D8]/80">
                {setupCommand}
              </pre>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[#F3C536]/30 bg-[#F3C536]/10 px-4 text-[12px] font-semibold text-[#F3C536] transition hover:bg-[#F3C536]/15"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                  {copied ? 'Copied' : 'Copy Codex Setup'}
                </button>
                <span className="text-[11px] text-[#EAE4D8]/40">Use this setup once, then continue from Codex.</span>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-amber-200/70">Run this only on your own machine where Codex is installed. Do not share the command.</p>
            </div>
          )}

          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#F3C536]">Active Codex Sessions</div>
              <button
                type="button"
                onClick={loadSessions}
                disabled={sessionsLoading}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 px-3 text-[11px] text-[#EAE4D8]/60 transition hover:border-[#F3C536]/30 hover:text-[#F3C536] disabled:opacity-40"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${sessionsLoading ? 'animate-spin' : ''}`} />
                Refresh Sessions
              </button>
            </div>

            {sessionsError && <p className="mt-3 text-[11px] text-rose-200">{sessionsError}</p>}

            {!sessionsLoading && activeSessions.length === 0 && (
              <p className="mt-3 text-[12px] text-[#EAE4D8]/45">No active Codex sessions. Connect Codex to create a new 30-day session.</p>
            )}

            {activeSessions.length > 0 && (
              <div className="mt-3 space-y-3">
                {activeSessions.map((session) => (
                  <div key={session.id} className="rounded-md border border-white/[0.08] bg-black/20 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-[#F5F0E5]">{shortAddr(session.id)}</span>
                          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-emerald-200">{session.status}</span>
                        </div>
                        <div className="mt-2 grid gap-1 text-[11px] text-[#EAE4D8]/45 sm:grid-cols-2 sm:gap-x-5">
                          <span>Created {formatDate(session.createdAt)}</span>
                          <span>Valid until {formatDate(session.expiresAt)}</span>
                          <span>Last used {formatDate(session.lastUsedAt)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRevoke(session.id)}
                        disabled={revokingSessionId === session.id}
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-rose-400/25 px-3 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-400/10 disabled:opacity-40"
                      >
                        {revokingSessionId === session.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                        Disconnect
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
