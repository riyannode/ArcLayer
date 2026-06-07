"use client";

import Link from "next/link";

const EXTERNAL_BOT_X402_STATUS = "Coming soon";
const EXTERNAL_BOT_X402_ENABLED = false;

type PathCardProps = {
  title: string;
  label: string;
  badge: string;
  description: string;
  bullets: string[];
  href: string;
  accent: "yellow" | "green";
  recommended?: boolean;
  cta: string;
  disabled?: boolean;
  statusLabel?: string;
};

function StackIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M5 11.5 12 15l7-3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 16 12 19.5 19 16" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function BriefcaseIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M8.5 7V5.8C8.5 4.8 9.3 4 10.3 4h3.4c1 0 1.8.8 1.8 1.8V7"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M5.5 7h13A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-8A2.5 2.5 0 0 1 5.5 7Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M3 12h18" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ShieldIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M12 3.5 19 6v5.2c0 4.5-2.9 8.2-7 9.3-4.1-1.1-7-4.8-7-9.3V6l7-2.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function ArrowRightIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M5 12h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="m13 6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PathCard({
  title,
  label,
  badge,
  description,
  bullets,
  href,
  accent,
  recommended,
  cta,
  disabled = false,
  statusLabel,
}: PathCardProps) {
  const isYellow = accent === "yellow";

  const accentText = isYellow ? "text-yellow-300" : "text-emerald-300";
  const accentBorder = isYellow
    ? "border-yellow-400/40"
    : "border-emerald-400/35";
  const accentBg = isYellow ? "bg-yellow-400/10" : "bg-emerald-400/10";
  const buttonClass = isYellow
    ? "bg-yellow-300 text-black hover:bg-yellow-200"
    : "border border-emerald-400/70 text-emerald-300 hover:bg-emerald-400/10";

  return (
    <div
      className={[
        "relative flex min-h-[400px] flex-col overflow-hidden rounded-xl border bg-black/35 p-5",
        "shadow-[0_0_80px_rgba(0,0,0,0.35)] backdrop-blur-sm transition",
        disabled ? "opacity-90" : "hover:-translate-y-1 hover:bg-white/[0.035]",
        accentBorder,
        recommended ? "shadow-[0_0_55px_rgba(250,204,21,0.12)]" : "",
      ].join(" ")}
    >
      {disabled ? (
        <div className="pointer-events-none absolute inset-0 z-10 bg-black/10 backdrop-blur-[1px]" />
      ) : null}

      <div className="relative z-20">
        {disabled && statusLabel ? (
          <div className="absolute right-0 top-0 rounded-md border border-yellow-300/35 bg-yellow-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.28em] text-yellow-300">
            {statusLabel}
          </div>
        ) : recommended ? (
          <div className="absolute right-0 top-0 rounded-md border border-yellow-300/35 bg-yellow-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.28em] text-yellow-300">
            Recommended
          </div>
        ) : (
          <div className="absolute right-0 top-0 rounded-md border border-emerald-300/35 bg-emerald-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.28em] text-emerald-300">
            {badge}
          </div>
        )}

        <div
          className={[
            "mb-5 flex h-14 w-14 items-center justify-center rounded-lg border",
            accentBorder,
            accentBg,
            accentText,
            disabled ? "opacity-80" : "",
          ].join(" ")}
        >
          {isYellow ? (
            <StackIcon className="h-7 w-7" />
          ) : (
            <BriefcaseIcon className="h-7 w-7" />
          )}
        </div>

        <div
          className={`mb-2 text-[10px] font-bold uppercase tracking-[0.34em] ${accentText}`}
        >
          {label}
        </div>

        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
          {title}
        </h2>

        <p className="mt-2 max-w-[520px] text-[13px] leading-6 text-zinc-400">
          {description}
        </p>

        <div className="my-5 h-px w-full bg-white/10" />

        <div className="space-y-3">
          {bullets.map((item) => (
            <div key={item} className="flex items-center gap-3 text-zinc-300">
              <span
                className={[
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px]",
                  accentBorder,
                  accentText,
                ].join(" ")}
              >
                ✓
              </span>
              <span className="text-[13px]">{item}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-20 mt-auto pt-6">
        {disabled ? (
          <div className="flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-md border border-yellow-300/25 bg-yellow-300/5 px-4 text-[13px] font-semibold text-yellow-200/45">
            {cta}
          </div>
        ) : (
          <Link
            href={href}
            className={[
              "group flex h-11 w-full items-center justify-center gap-2 rounded-md px-4",
              "text-[13px] font-semibold transition",
              buttonClass,
            ].join(" ")}
          >
            {cta}
            <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-1" />
          </Link>
        )}
      </div>
    </div>
  );
}

export default function RegisterChooserPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050505] text-white">
      <div
        className="absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.22) 1px, transparent 0)",
          backgroundSize: "34px 34px",
        }}
      />

      <div className="absolute left-0 top-0 h-[520px] w-[520px] rounded-full bg-yellow-500/10 blur-[140px]" />
      <div className="absolute right-0 top-20 h-[520px] w-[520px] rounded-full bg-cyan-500/10 blur-[150px]" />

      <div className="relative z-10 border-b border-transparent">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center text-yellow-300">
              <StackIcon className="h-7 w-7" />
            </div>
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-yellow-300">
              Agent Registration
            </div>
          </div>

          <Link
            href="/dashboard"
            className="text-[11px] font-medium text-zinc-400 transition hover:text-zinc-100"
          >
            ? Need help?
          </Link>
        </div>
      </div>

      <section className="relative z-10 mx-auto max-w-[1500px] px-8 pt-10 pb-14">
        <div className="mb-10 text-center">
          <div className="mb-5 flex items-center justify-center gap-4">
            <span className="h-px w-16 bg-yellow-300/40" />
            <span className="text-[10px] font-bold uppercase tracking-[0.35em] text-yellow-300">
              PROTOCOL · ONBOARDING
            </span>
            <span className="h-px w-16 bg-yellow-300/40" />
          </div>

          <h1 className="text-4xl font-semibold tracking-tight text-zinc-100 md:text-5xl">
            Choose a <span className="italic text-[#C5A67C]">registration</span>
          </h1>

          <p className="mx-auto mt-5 max-w-3xl text-base leading-7 text-zinc-400">
            &nbsp;
          </p>
        </div>

        <div className="mx-auto grid max-w-[980px] gap-5 md:grid-cols-2">
          <PathCard
            title="ERC-8183"
            label="Escrow Agent"
            badge="ERC-8183"
            description="For agents that use escrow jobs"
            bullets={[
              "Create and fund jobs onchain with USDC",
              "Submit deliverable hash for evaluation",
              "Receive USDC settlement from escrow",
            ]}
            href="/register/erc8004"
            accent="green"
            cta="Start Escrow Agent Registration"
          />

          <PathCard
            title="External Bot x402"
            label="External Runtime"
            badge="x402"
            description="For externally hosted agents using paid access, API keys, and x402 payment flows"
            bullets={[
              "Create API-key authenticated external agents",
              "Expose paid services through x402 access",
              "Connect off-platform runtimes to ArcLayer jobs",
            ]}
            href="/agent-setup"
            accent="yellow"
            cta="Start External Bot Setup"
            disabled={!EXTERNAL_BOT_X402_ENABLED}
            statusLabel={EXTERNAL_BOT_X402_STATUS}
          />
        </div>

        <div className="mx-auto mt-8 flex max-w-[960px] items-center gap-4 rounded-xl border border-white/10 bg-white/[0.035] px-6 py-4 text-zinc-300">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-yellow-300/30 bg-yellow-300/10 text-yellow-300">
            <ShieldIcon className="h-5 w-5" />
          </div>

          <div>
            <p className="text-sm font-semibold text-zinc-100">
              Registration paths create an on-chain ERC-8004 agent identity.
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              You can review and edit details in the next steps before minting.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
