'use client';

import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Clipboard, KeyRound, Loader2 } from 'lucide-react';
import { useSignMessage } from 'wagmi';

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

function shortAddr(value?: string) {
  if (!value) return '—';
  if (value.length < 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
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
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const configText = useMemo(() => {
    if (!result?.claudeConfig) return '';

    return [
      `ARCLAYER_MCP_URL=${result.claudeConfig.ARCLAYER_MCP_URL}`,
      `ARCLAYER_MCP_TOKEN=${result.claudeConfig.ARCLAYER_MCP_TOKEN}`,
      `MCP_TRANSPORT=${result.claudeConfig.MCP_TRANSPORT}`,
    ].join('\n');
  }, [result]);

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
        setError(data.detail || data.error || 'Failed to create MCP session.');
        return;
      }

      setResult(data);
    } catch {
      setError('Network error while creating MCP session.');
    } finally {
      setLoading(false);
    }
  }, [ensureSession, ownerAddress]);

  const handleCopy = useCallback(async () => {
    if (!configText) return;

    await copyToClipboard(configText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [configText]);

  return (
    <div className="rounded-lg border border-white/10 bg-[#07090D]/88 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-white/[0.025]"
      >
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
            MCP Identity Session
          </div>
          <div className="mt-1 text-[12px] text-[#EAE4D8]/45">
            Create MCP token for Claude/Codex using the connected EOA.
          </div>
        </div>

        <div className="text-[#F3C536]">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] px-5 pb-5 pt-1">
          <div className="mt-3 grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/[0.06] py-3">
            <div className="text-[13px] text-[#EAE4D8]/60">
              Owner Wallet
            </div>

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

          <button
            type="button"
            onClick={handleCreate}
            disabled={loading || !ownerAddress}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-black transition hover:bg-[#F3C536]/90 disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <KeyRound className="h-3.5 w-3.5" />
            )}
            Create MCP Session
          </button>

          {error && (
            <div className="mt-4 rounded-md border border-rose-400/25 bg-rose-400/[0.055] px-4 py-3 text-[12px] text-rose-200">
              {error}
            </div>
          )}

          {result?.claudeConfig && (
            <div className="mt-5 rounded-md border border-[#F3C536]/20 bg-black/35 p-4">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#F3C536]">
                MCP Config
              </div>

              <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-[#EAE4D8]/80">
                {configText}
              </pre>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-[#F3C536]/30 bg-[#F3C536]/10 px-4 text-[12px] font-semibold text-[#F3C536] transition hover:bg-[#F3C536]/15"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                  {copied ? 'Copied' : 'Copy MCP Config'}
                </button>

                <span className="text-[11px] text-[#EAE4D8]/40">
                  Save this token now. It is only shown once.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
