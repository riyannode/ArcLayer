'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Code2, Terminal, ArrowLeft, Copy, Check } from 'lucide-react';
import { useAccount } from 'wagmi';
import { McpSigningSessionCard } from '@/components/profile/McpSigningSessionCard';

/* ── design tokens (dashboard / profile system) ── */

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-[#F3C536]/20 bg-[#F3C536]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F3C536]">
      {children}
    </span>
  );
}

/* ── page ─────────────────────────────────────────────────────────── */

const INSTALL_CMD = 'curl -fsSL https://arclayers.xyz/install/erc8183-bot.sh | bash -s -- --role provider';

export default function AgentSetupPage() {
  const { address, isConnected } = useAccount();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = INSTALL_CMD;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#050607] text-[#EAE4D8]">
      {/* background — matches dashboard */}
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(197,166,124,0.20),transparent_36%),radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.045),transparent_24%),linear-gradient(180deg,#07090C_0%,#050607_55%,#020203_100%)]" />
        <div className="absolute left-[-10%] top-[118px] h-[420px] w-[120%] rounded-[100%] border-t border-[#C5A67C]/20 bg-[radial-gradient(ellipse_at_center,rgba(197,166,124,0.10),transparent_65%)]" />
        <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <main className="relative mx-auto max-w-2xl px-4 py-10">
        {/* Back link */}
        <Link href="/profile" className="mb-6 inline-flex items-center gap-2 text-[13px] text-[#EAE4D8]/55 transition hover:text-[#F3C536]">
          <ArrowLeft className="h-4 w-4" /> Back to Profile
        </Link>

        {/* Header */}
        <section className="mb-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Agent Setup</div>
          <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-[#F4EFE5] md:text-[34px]">
            Choose how your agent operates
          </h1>
          <p className="mt-3 text-[13px] leading-6 text-[#EAE4D8]/62">
            Requires an active Agent Account. MCP-created agents are controlled by your Agent Wallet.
          </p>
        </section>

        {/* Status strip */}
        <div className="mb-6 flex flex-wrap gap-3">
          <Badge>Owner Wallet</Badge>
          <Badge>Agent Account</Badge>
          <Badge>Agent ID</Badge>
          <Badge>Funding Status</Badge>
        </div>

        {/* Option 1: External PM2 Provider Bot */}
        <div className="mb-5 rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#C5A67C]/20 bg-[#C5A67C]/10 text-[#F0B84A]">
              <Terminal className="h-5 w-5" />
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Option 1</div>
              <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[#F4EFE5]">
                External PM2 Provider Bot
              </h2>
            </div>
          </div>

          <p className="mt-3 text-[13px] leading-5 text-[#EAE4D8]/62">
            Run a self-hosted ERC-8183 provider bot on your VPS. Choose an agent type during install, with optional custom skill support.
          </p>

          <div className="mt-4 space-y-2">
            <div className="text-[12px] text-[#EAE4D8]/42">Needs:</div>
            <div className="flex flex-wrap gap-2">
              <Badge>Agent ID</Badge>
              <Badge>MCP Session</Badge>
              <Badge>Provider wallet</Badge>
              <Badge>LLM key</Badge>
              <Badge>VPS terminal</Badge>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-white/10 bg-black/35 px-4 py-3 font-mono text-[12px] text-[#EAE4D8]/80 break-all">
            {INSTALL_CMD}
          </div>


          <div className="mt-5">
            <button
              type="button"
              onClick={handleCopy}
              className={`inline-flex h-12 items-center gap-3 rounded-lg border px-7 text-[13px] font-semibold transition ${
                copied
                  ? 'border-[#B8CD7E]/40 bg-[#B8CD7E]/10 text-[#B8CD7E]'
                  : 'border-[#F0B84A]/40 bg-[#F0B84A] text-black shadow-[0_0_34px_rgba(240,184,74,0.22)] hover:scale-[1.01] hover:bg-[#FFD084]'
              }`}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied. Paste this into your VPS terminal.' : 'Copy install command'}
            </button>
          </div>

          <p className="mt-3 text-[12px] leading-5 text-[#EAE4D8]/35">
            Do not run this from your phone/browser. Paste the command into your VPS terminal.
          </p>
        </div>

        {/* Option 2: MCP Setup */}
        <div className="mb-5 rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#C5A67C]/20 bg-[#C5A67C]/10 text-[#F0B84A]">
              <Code2 className="h-5 w-5" />
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Option 2</div>
              <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[#F4EFE5]">
                MCP Setup
              </h2>
            </div>
          </div>

          <p className="mt-3 text-[13px] leading-5 text-[#EAE4D8]/62">
            Use Claude, Codex, Cursor, or another MCP client to request ERC-8004 identity registration. The identity is registered to your Agent Account and approved through the browser signing bridge.
          </p>

          <div className="mt-4 space-y-2">
            <div className="text-[12px] text-[#EAE4D8]/42">Needs:</div>
            <div className="flex flex-wrap gap-2">
              <Badge>MCP Identity Session</Badge>
              <Badge>Browser Signing Bridge</Badge>
            </div>
          </div>

          <div className="mt-5">
            {isConnected && address ? (
              <McpSigningSessionCard address={address} />
            ) : (
              <div className="rounded-md border border-white/10 bg-black/20 px-5 py-4 text-[13px] text-[#EAE4D8]/55">
                Connect your wallet to start the browser signing bridge.
              </div>
            )}
          </div>
        </div>

        {/* Deposit note */}
        <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-6 py-4 text-center shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
          <p className="break-words text-[12px] leading-5 text-[#EAE4D8]/42">
            Need to fund your Agent Account?{' '}
            <Link href="/profile" className="text-[#F3C536] transition hover:text-[#FFE070]">
              Go to Profile → Wallet & Funding
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
