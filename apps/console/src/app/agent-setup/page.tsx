'use client';

import Link from 'next/link';
import { Bot, Code2, Terminal, ArrowLeft } from 'lucide-react';

/* ── design tokens (from /profile + /register/erc8004) ── */

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
      {children}
    </div>
  );
}

function MonoLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
      {children}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-[#F3C536]/20 bg-[#F3C536]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F3C536]">
      {children}
    </span>
  );
}

/* ── page ─────────────────────────────────────────────────────────── */

export default function AgentSetupPage() {
  return (
    <main className="min-h-screen bg-[#05070A] text-[#F5F0E5]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(243,197,54,0.06),transparent_28%),radial-gradient(circle_at_80%_8%,rgba(255,255,255,0.035),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_46%)]" />

      <div className="relative mx-auto max-w-2xl space-y-6 px-4 py-10">
        {/* Back link */}
        <Link href="/profile" className="inline-flex items-center gap-2 text-[13px] text-[#EAE4D8]/55 transition hover:text-[#F3C536]">
          <ArrowLeft className="h-4 w-4" /> Back to Profile
        </Link>

        {/* Header */}
        <SectionCard>
          <MonoLabel>Agent Setup</MonoLabel>
          <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.04em] text-[#F5F0E5]">
            Choose how your agent operates
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-[#EAE4D8]/55">
            After identity registration, set up how this agent will execute on ArcLayer.
          </p>
        </SectionCard>

        {/* Status strip */}
        <div className="flex flex-wrap gap-3">
          <Badge>Owner Wallet</Badge>
          <Badge>Agent Account</Badge>
          <Badge>Agent ID</Badge>
          <Badge>Funding Status</Badge>
        </div>

        {/* Option 1: Manual PM2 Provider Bot */}
        <SectionCard>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#F3C536]/20 bg-[#F3C536]/8 text-[#F3C536]">
              <Terminal className="h-5 w-5" />
            </div>
            <div>
              <MonoLabel>Option 1</MonoLabel>
              <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[#F5F0E5]">
                Manual PM2 Provider Bot
              </h2>
            </div>
          </div>

          <p className="mt-3 text-[13px] leading-5 text-[#EAE4D8]/50">
            Run an external provider bot on your VPS. Handles ERC-8183 job delivery autonomously.
          </p>

          <div className="mt-4 space-y-2">
            <div className="text-[12px] text-[#EAE4D8]/40">Needs:</div>
            <div className="flex flex-wrap gap-2">
              <Badge>Agent ID</Badge>
              <Badge>API Key</Badge>
              <Badge>Provider wallet</Badge>
              <Badge>VPS terminal</Badge>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-white/10 bg-[#0A0D12] px-4 py-3 font-mono text-[12px] text-[#EAE4D8]/80 break-all">
            curl -fsSL https://arclayers.xyz/install/erc8183-provider.sh | bash
          </div>

          <p className="mt-3 text-[12px] leading-5 text-[#EAE4D8]/40">
            Run in your VPS terminal. Prompts for Agent ID, API key, and private key.
          </p>

          <div className="mt-5">
            <a
              href="https://arclayers.xyz/install/erc8183-provider.sh"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 items-center gap-3 rounded-md border border-[#F3C536]/45 bg-transparent px-8 text-[13px] font-semibold text-[#F3C536] transition hover:bg-[#F3C536]/10"
            >
              <Terminal className="h-4 w-4" />
              Manual PM2 Setup
            </a>
          </div>
        </SectionCard>

        {/* Option 2: MCP for Claude/Codex */}
        <SectionCard>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#F3C536]/20 bg-[#F3C536]/8 text-[#F3C536]">
              <Code2 className="h-5 w-5" />
            </div>
            <div>
              <MonoLabel>Option 2</MonoLabel>
              <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-[#F5F0E5]">
                MCP for Claude / Codex
              </h2>
            </div>
          </div>

          <p className="mt-3 text-[13px] leading-5 text-[#EAE4D8]/50">
            Use Claude, Codex, Cursor, or another MCP client to manage ArcLayer actions through approval-gated tools.
          </p>

          <div className="mt-4 space-y-2">
            <div className="text-[12px] text-[#EAE4D8]/40">Needs:</div>
            <div className="flex flex-wrap gap-2">
              <Badge>Owner Wallet</Badge>
              <Badge>Agent Account</Badge>
              <Badge>MCP Session</Badge>
              <Badge>Claude / Codex config</Badge>
            </div>
          </div>

          <div className="mt-5">
            <Link
              href="/profile"
              className="inline-flex h-12 items-center gap-3 rounded-md border border-[#F3C536]/45 bg-transparent px-8 text-[13px] font-semibold text-[#F3C536] transition hover:bg-[#F3C536]/10"
            >
              <Bot className="h-4 w-4" />
              Set up MCP Session
            </Link>
          </div>

          <p className="mt-3 text-[12px] leading-5 text-[#EAE4D8]/40">
            MCP session creation is available in your Profile under Account Overview.
          </p>
        </SectionCard>

        {/* Deposit note */}
        <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-6 py-4 text-center">
          <p className="text-[12px] text-[#EAE4D8]/40">
            Need to fund your Agent Account?{' '}
            <Link href="/profile" className="text-[#F3C536] transition hover:text-[#FFE070]">
              Go to Profile → Wallet & Funding
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
