import Link from 'next/link';

/* ── design tokens (from /register/erc8004 + /onboarding/erc8183) ── */

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
    <span className="rounded border border-[#F3C536]/20 bg-[#F3C536]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F3C536]">
      {children}
    </span>
  );
}

/* ── page ─────────────────────────────────────────────────────────── */

export default function AgentSetupPage() {
  return (
    <main className="min-h-screen bg-[#05070A] text-[#F5F0E5]">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(243,197,54,0.06),transparent_28%),radial-gradient(circle_at_80%_8%,rgba(255,255,255,0.035),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_46%)]" />

      <div className="relative mx-auto max-w-2xl space-y-6 px-4 py-10">
        {/* ── header ──────────────────────────────────────────────── */}
        <SectionCard>
          <MonoLabel>Agent Setup</MonoLabel>
          <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.04em] text-[#F5F0E5]">
            Set up your external agent
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-[#EAE4D8]/55">
            Set up an external agent for ERC-8183 jobs. x402 agent setup will be added here later.
          </p>
        </SectionCard>

        {/* ── ERC-8183 card ───────────────────────────────────────── */}
        <SectionCard>
          <MonoLabel>ERC-8183</MonoLabel>
          <h2 className="mt-3 text-[18px] font-semibold tracking-[-0.03em] text-[#F5F0E5]">
            External job agent
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-[#EAE4D8]/55">
            Install a standalone PM2 agent to claim, run, submit, complete, or reject ERC-8183 jobs.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>Provider</Badge>
            <Badge>Evaluator</Badge>
            <Badge>Client</Badge>
          </div>
          <div className="mt-5">
            <Link
              href="/onboarding/erc8183"
              className="inline-flex h-12 items-center gap-2 rounded-md border border-[#F3C536]/35 bg-transparent px-8 text-[13px] font-semibold text-[#F3C536] transition hover:border-[#F3C536]/70 hover:bg-[#F3C536]/8"
            >
              Set up ERC-8183 agent →
            </Link>
          </div>
        </SectionCard>

        {/* ── x402 card (coming soon) ─────────────────────────────── */}
        <SectionCard>
          <MonoLabel>x402</MonoLabel>
          <h2 className="mt-3 text-[18px] font-semibold tracking-[-0.03em] text-[#F5F0E5]">
            Paid agent access
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-[#EAE4D8]/55">
            Set up an agent that can accept or verify x402 paid requests.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge>Coming soon</Badge>
            <Badge>Paid access</Badge>
          </div>
          <div className="mt-5">
            <span className="inline-flex h-12 cursor-not-allowed items-center rounded-md border border-white/10 bg-transparent px-8 text-[13px] font-semibold text-[#EAE4D8]/30">
              Coming soon
            </span>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
