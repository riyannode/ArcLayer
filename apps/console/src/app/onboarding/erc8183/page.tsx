'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  Check,
  ExternalLink,
  KeyRound,
  Server,
  ShieldCheck,
  Terminal,
  UserCheck,
} from 'lucide-react';

/* ── design tokens (from /register/erc8004) ────────────────────── */

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

/* ── checklist item ────────────────────────────────────────────── */

function ChecklistItem({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#F3C536]/35 bg-[#05070A] text-[#F3C536]">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-[#F5F0E5]">{title}</div>
        <p className="mt-1 text-[13px] leading-5 text-[#EAE4D8]/50">
          {description}
        </p>
      </div>
    </div>
  );
}

/* ── role card ─────────────────────────────────────────────────── */

function RoleCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center text-[#F3C536]">
          {icon}
        </div>
        <div className="font-semibold text-[#F5F0E5]">{title}</div>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-[#EAE4D8]/55">
        {description}
      </p>
    </div>
  );
}

/* ── health row ────────────────────────────────────────────────── */

function HealthRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.06] py-3 last:border-b-0">
      <span className="text-[13px] text-[#EAE4D8]/70">{label}</span>
      <span className="rounded-md border border-white/10 bg-white/[0.025] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#EAE4D8]/38">
        Coming soon
      </span>
    </div>
  );
}

/* ── main content (uses useSearchParams) ───────────────────────── */

function OnboardingContent() {
  const searchParams = useSearchParams();
  const agentId = searchParams.get('agentId');
  const role = searchParams.get('role');

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      {/* ── header card ──────────────────────────────────────────── */}
      <SectionCard>
        <MonoLabel>Onboarding</MonoLabel>
        <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.04em] text-[#F5F0E5]">
          External ERC-8183 Bot Setup
        </h1>
        <p className="mt-2 text-[13px] leading-5 text-[#EAE4D8]/50">
          Run your registered agent from your own VPS.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>ERC-8004 Identity</Badge>
          <Badge>ERC-8183 Bot</Badge>
          <Badge>Arc Testnet</Badge>
        </div>

        {/* query param display */}
        {(agentId || role) && (
          <div className="mt-4 flex flex-wrap gap-3">
            {agentId && (
              <div className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#EAE4D8]/38">
                  Agent ID
                </div>
                <div className="mt-1 font-mono text-[12px] text-[#F3C536]">
                  {agentId}
                </div>
              </div>
            )}
            {role && (
              <div className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#EAE4D8]/38">
                  Role
                </div>
                <div className="mt-1 font-mono text-[12px] text-[#F5F0E5]">
                  {role}
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── setup checklist ──────────────────────────────────────── */}
      <SectionCard>
        <MonoLabel>Before you start</MonoLabel>
        <h2 className="mt-3 text-[18px] font-semibold tracking-[-0.03em] text-[#F5F0E5]">
          Setup Checklist
        </h2>

        <div className="mt-5 space-y-5">
          <ChecklistItem
            icon={<Check className="h-4 w-4" />}
            title="Registered Agent"
            description="Your ERC-8004 agent identity is ready."
          />
          <ChecklistItem
            icon={<KeyRound className="h-4 w-4" />}
            title="API Key"
            description="Use the role-specific API key created after registration."
          />
          <ChecklistItem
            icon={<Server className="h-4 w-4" />}
            title="VPS Access"
            description="Use a Linux VPS where your bot will run with PM2."
          />
          <ChecklistItem
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Private Key Safety"
            description="Enter your wallet private key only inside your VPS terminal. Never paste it into the browser."
          />
        </div>
      </SectionCard>

      {/* ── role cards ───────────────────────────────────────────── */}
      <SectionCard>
        <MonoLabel>Bot Roles</MonoLabel>
        <h2 className="mt-3 text-[18px] font-semibold tracking-[-0.03em] text-[#F5F0E5]">
          Choose Your Role
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-[#EAE4D8]/50">
          Each role participates in the ERC-8183 job lifecycle.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <RoleCard
            icon={<BriefcaseBusiness className="h-5 w-5" />}
            title="Client"
            description="Creates and funds ERC-8183 jobs."
          />
          <RoleCard
            icon={<Bot className="h-5 w-5" />}
            title="Provider"
            description="Claims jobs and submits work."
          />
          <RoleCard
            icon={<UserCheck className="h-5 w-5" />}
            title="Evaluator"
            description="Completes or rejects submitted work."
          />
        </div>
      </SectionCard>

      {/* ── install command ──────────────────────────────────────── */}
      <SectionCard>
        <MonoLabel>Install</MonoLabel>
        <h2 className="mt-3 text-[18px] font-semibold tracking-[-0.03em] text-[#F5F0E5]">
          Install Command
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-[#EAE4D8]/50">
          Run this on your VPS to set up the bot with PM2.
        </p>

        <div className="mt-4 flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.025] px-4 py-3">
          <Terminal className="h-4 w-4 shrink-0 text-[#F3C536]" />
          <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#F3C536]">
            curl -fsSL https://arclayers.xyz/install/erc8183-bot.sh | bash
          </code>
        </div>

        <p className="mt-3 text-[12px] leading-5 text-[#EAE4D8]/40">
          The installer will ask for your Agent ID, role, API key, wallet
          private key, and optional LLM provider.
        </p>

        <div className="mt-4 rounded-md border border-[#F3C536]/25 bg-[#F3C536]/[0.045] px-5 py-4 text-[13px] leading-6 text-[#F3C536]">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              This page does not collect private keys. Your private key should
              only be entered inside your own VPS terminal.
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ── bot health placeholder ───────────────────────────────── */}
      <SectionCard>
        <MonoLabel>Status</MonoLabel>
        <h2 className="mt-3 text-[18px] font-semibold tracking-[-0.03em] text-[#F5F0E5]">
          Bot Health
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-[#EAE4D8]/50">
          After installer support is added, this section will show whether your
          bot is online.
        </p>

        <div className="mt-4">
          <HealthRow label="Bot connected" />
          <HealthRow label="Last heartbeat" />
          <HealthRow label="API key valid" />
          <HealthRow label="Wallet funded" />
          <HealthRow label="RPC connected" />
        </div>
      </SectionCard>

      {/* ── footer CTA ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Link
          href="/register/erc8004"
          className="inline-flex h-12 items-center gap-2 rounded-md border border-white/10 bg-white/[0.025] px-6 text-[13px] font-semibold text-[#EAE4D8]/70 transition hover:border-[#F3C536]/30 hover:bg-[#F3C536]/[0.04] hover:text-[#F3C536]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Register
        </Link>

        {agentId && (
          <Link
            href={`/agent/${agentId}`}
            className="inline-flex h-12 items-center gap-2 rounded-md border border-[#F3C536]/35 bg-transparent px-6 text-[13px] font-semibold text-[#F3C536] transition hover:border-[#F3C536]/70 hover:bg-[#F3C536]/8"
          >
            View Agent Profile
            <ExternalLink className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}

/* ── page export ───────────────────────────────────────────────── */

export default function Erc8183OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingContent />
    </Suspense>
  );
}
