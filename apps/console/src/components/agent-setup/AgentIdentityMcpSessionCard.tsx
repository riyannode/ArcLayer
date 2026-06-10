'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Clipboard, KeyRound, Loader2, Unplug } from 'lucide-react';
import { useSignMessage } from 'wagmi';
import {
  buildBashCodexSetup,
  buildPowerShellCodexSetup,
} from '@/lib/mcp/codex-setup-command';

type McpSessionCreateResponse = {
  ok: boolean;
  session?: {
    id: string;
    expiresAt: string;
  };
  claudeConfig?: {
    ARCLAYER_MCP_URL: string;
    ARCLAYER_MCP_TOKEN: string;
    MCP_TRANSPORT: string;
  };
  error?: string;
  detail?: string;
};

function shortAddr(value?: string) {
  if (!value) return '—';
  if (value.length < 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

async function copyToClipboard(value: string) {
  await navigator.clipboard.writeText(value);
}

export function AgentIdentityMcpSessionCard({ ownerAddress }: { ownerAddress?: string }) {
  const { signMessageAsync } = useSignMessage();
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<McpSessionCreateResponse | null>(null);
  const [setupShell, setSetupShell] = useState<'powershell' | 'bash'>('powershell');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');

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
      if (!await ensureSession()) {
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
    } catch {
      setError('Network error while connecting Codex.');
    } finally {
      setLoading(false);
    }
  }, [ensureSession, ownerAddress]);

  const handleDisconnect = useCallback(async () => {
    const sessionId = result?.session?.id;
    if (!sessionId) return;

    setError('');
    setDisconnecting(true);

    try {
      if (!await ensureSession()) {
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

      setResult(null);
      setCopied(false);
    } catch {
      setError('Network error while disconnecting Codex.');
    } finally {
      setDisconnecting(false);
    }
  }, [ensureSession, result?.session?.id]);

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
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Codex Auth Session</div>
          <div className="mt-1 text-[12px] text-[#EAE4D8]/45">Connect Codex to ArcLayer using the connected wallet.</div>
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
              <span className="truncate font-mono text-[13px] text-[#F5F0E5]">{shortAddr(ownerAddress)}</span>
              {ownerAddress && (
                <button type="button" onClick={() => copyToClipboard(ownerAddress)} className="text-[#EAE4D8]/45 transition hover:text-[#F3C536]" aria-label="Copy owner wallet">
                  <Clipboard className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={handleCreate} disabled={loading || !ownerAddress} className="inline-flex h-10 items-center gap-2 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-black transition hover:bg-[#F3C536]/90 disabled:opacity-40">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              Connect Codex
            </button>
            <span className="text-[11px] text-[#EAE4D8]/40">Valid for 30 days. Reconnect anytime after expiry.</span>
          </div>

          {error && <div className="mt-4 rounded-md border border-rose-400/25 bg-rose-400/[0.055] px-4 py-3 text-[12px] text-rose-200">{error}</div>}

          {result?.session && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-400/20 bg-emerald-400/[0.055] px-4 py-3">
              <div>
                <div className="text-[12px] font-semibold text-emerald-200">Connected</div>
                <div className="mt-1 text-[11px] text-[#EAE4D8]/50">Valid until {formatDate(result.session.expiresAt)}</div>
              </div>
              <button type="button" onClick={handleDisconnect} disabled={disconnecting} className="inline-flex h-8 items-center gap-2 rounded-md border border-rose-400/25 px-3 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-400/10 disabled:opacity-40">
                {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                Disconnect Codex
              </button>
            </div>
          )}

          {result?.claudeConfig && (
            <div className="mt-5 rounded-md border border-[#F3C536]/20 bg-black/35 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#F3C536]">Codex Connection</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setSetupShell('powershell')} className={setupShell === 'powershell' ? 'rounded-md bg-[#F3C536] px-3 py-2 text-[11px] font-semibold text-black' : 'rounded-md border border-white/10 px-3 py-2 text-[11px] text-[#EAE4D8]/60 hover:border-[#F3C536]/30'}>Windows PowerShell</button>
                <button type="button" onClick={() => setSetupShell('bash')} className={setupShell === 'bash' ? 'rounded-md bg-[#F3C536] px-3 py-2 text-[11px] font-semibold text-black' : 'rounded-md border border-white/10 px-3 py-2 text-[11px] text-[#EAE4D8]/60 hover:border-[#F3C536]/30'}>macOS/Linux Bash</button>
              </div>
              <pre className="mt-3 max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-md border border-white/[0.06] bg-black/35 p-3 font-mono text-[11px] leading-5 text-[#EAE4D8]/80">{setupCommand}</pre>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" onClick={handleCopy} className="inline-flex h-9 items-center gap-2 rounded-md border border-[#F3C536]/30 bg-[#F3C536]/10 px-4 text-[12px] font-semibold text-[#F3C536] transition hover:bg-[#F3C536]/15">
                  <Clipboard className="h-3.5 w-3.5" />
                  {copied ? 'Copied' : 'Copy Codex Setup'}
                </button>
                <span className="text-[11px] text-[#EAE4D8]/40">Use this setup once, then continue from Codex.</span>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-amber-200/70">Run this only on your own machine where Codex is installed. Do not share the command.</p>
            </div>
          )}

          <Link href="/profile#mcp-sessions" className="mt-4 inline-flex text-[11px] text-[#F3C536] underline-offset-4 hover:underline">Manage MCP sessions in Profile</Link>
        </div>
      )}
    </div>
  );
}
