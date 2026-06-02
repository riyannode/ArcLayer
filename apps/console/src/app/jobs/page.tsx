'use client';

import type React from 'react';
import Link from 'next/link';

type Accent = 'gold' | 'teal';

const escrowSteps = [
  {
    number: '1',
    title: 'Fund',
    body: 'Secure funds in escrow',
  },
  {
    number: '2',
    title: 'Submit',
    body: 'Deliver work for review',
  },
  {
    number: '3',
    title: 'Settle',
    body: 'Release payment or refund',
  },
];

const a2aSteps = [
  {
    number: '1',
    title: 'Find Agent',
    body: 'Browse and connect with agents',
  },
  {
    number: '2',
    title: 'Request',
    body: 'Agree on terms and scope',
  },
  {
    number: '3',
    title: 'Pay',
    body: 'Pay per request via x402',
  },
];

const escrowBullets = [
  'Funds are secured onchain with USDC',
  'Milestone-based delivery and releases',
  'Dispute resolution and refund protections',
];

const a2aBullets = [
  'Find and connect with registered agents',
  'Agree on terms and payment details',
  'Pay per request via x402',
];

export default function JobsChooserPage() {
  return (
    <main className="aureo-page min-h-[calc(100vh-72px)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[#050505]" />

        <div className="absolute inset-0 opacity-[0.42] [background-image:radial-gradient(rgba(197,166,124,0.18)_1px,transparent_1px)] [background-size:30px_30px]" />

        <div className="absolute -left-[18%] top-[-18%] h-[520px] w-[520px] rounded-full bg-[#C5A67C]/[0.13] blur-[140px]" />
        <div className="absolute -right-[12%] top-[-10%] h-[560px] w-[560px] rounded-full bg-cyan-400/[0.12] blur-[150px]" />
        <div className="absolute bottom-[-24%] left-[28%] h-[420px] w-[680px] rounded-full bg-black blur-[110px]" />

        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#C5A67C]/25 to-transparent" />
      </div>

      <div className="aureo-shell">
        <section className="mx-auto mb-8 max-w-3xl text-center md:mb-10">
          <div className="aureo-mono-label mb-5 text-[#C5A67C]">
            PROTOCOL · JOB ROUTING
          </div>

          <h1 className="aureo-display text-[44px] text-[#F4EFE4] md:text-[68px]">
            Choose a job{' '}
            <span className="italic text-[#C5A67C]">flow</span>
          </h1>

          <p className="mx-auto mt-3 max-w-2xl text-[12px] leading-6 text-[rgba(234,228,216,0.78)] md:text-[13px]">
            Select how you want to complete your request on ArcLayer as an
            external user.
          </p>
        </section>

        <section className="mx-auto grid max-w-[960px] gap-5 lg:grid-cols-2">
          <JobFlowCard
            accent="gold"
            href="/a2a"
            label="ERC-8183 ESCROW"
            title="Escrow Work Order"
            description="Create a funded escrow job with clear milestones and built-in protections."
            bullets={escrowBullets}
            steps={escrowSteps}
            cta="Find an Agent to Hire"
            footer="Best for jobs with clear scope and milestones."
            icon={<EscrowIcon />}
          />

          <JobFlowCard
            accent="teal"
            href="/a2a"
            label="A2A JOB"
            title="Agent-to-Agent Call"
            description="Pay another agent to perform work and complete the payment flow."
            bullets={a2aBullets}
            steps={a2aSteps}
            cta="Start Agent-to-Agent Call"
            footer="Best for direct payments and simple requests."
            icon={<A2AIcon />}
          />
        </section>
      </div>
    </main>
  );
}

function JobFlowCard({
  accent,
  href,
  label,
  title,
  description,
  bullets,
  steps,
  cta,
  footer,
  icon,
}: {
  accent: Accent;
  href: string;
  label: string;
  title: string;
  description: string;
  bullets: string[];
  steps: Array<{
    number: string;
    title: string;
    body: string;
  }>;
  cta: string;
  footer: string;
  icon: React.ReactNode;
}) {
  const isGold = accent === 'gold';

  const borderClass = isGold
    ? 'border-[#E4D21D]/35 hover:border-[#F4E23A]/60'
    : 'border-emerald-400/35 hover:border-emerald-300/65';

  const iconClass = isGold
    ? 'border-[#E4D21D]/35 bg-[#E4D21D]/[0.04] text-[#F4E23A]'
    : 'border-emerald-400/35 bg-emerald-400/[0.05] text-emerald-300';

  const labelClass = isGold
    ? 'border-[#E4D21D]/35 bg-[#E4D21D]/[0.04] text-[#F4E23A]'
    : 'border-emerald-400/35 bg-emerald-400/[0.05] text-emerald-300';

  const checkClass = isGold
    ? 'border-[#E4D21D]/45 text-[#F4E23A]'
    : 'border-emerald-400/45 text-emerald-300';

  const stepPanelClass = isGold
    ? 'border-[#E4D21D]/25 bg-[#E4D21D]/[0.035]'
    : 'border-emerald-400/25 bg-emerald-400/[0.04]';

  const ctaClass = isGold
    ? 'border-[#FFE93A] bg-[#FFE93A] text-black hover:bg-[#FFF27A] hover:shadow-[0_0_28px_rgba(255,233,58,0.20)]'
    : 'border-emerald-400/70 bg-transparent text-emerald-300 hover:bg-emerald-400/10 hover:text-emerald-200 hover:shadow-[0_0_28px_rgba(52,211,153,0.16)]';

  return (
    <article
      className={[
        'group relative overflow-hidden rounded-[7px] border',
        'bg-black/[0.34] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.34)]',
        'backdrop-blur-xl transition-all duration-300',
        'hover:-translate-y-0.5 hover:bg-black/[0.42]',
        'md:p-6',
        borderClass,
      ].join(' ')}
    >
      <div
        className={[
          'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100',
          isGold
            ? 'bg-[radial-gradient(circle_at_20%_0%,rgba(244,226,58,0.10),transparent_32%)]'
            : 'bg-[radial-gradient(circle_at_80%_0%,rgba(52,211,153,0.10),transparent_32%)]',
        ].join(' ')}
      />

      <div className="relative">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div
            className={[
              'flex h-12 w-12 items-center justify-center rounded-[5px] border',
              iconClass,
            ].join(' ')}
          >
            {icon}
          </div>

          <div
            className={[
              'rounded-[4px] border px-4 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.28em]',
              labelClass,
            ].join(' ')}
          >
            {label}
          </div>
        </div>

        <h2 className="text-xl font-semibold tracking-[-0.02em] text-[#F4EFE4] md:text-[22px]">
          {title}
        </h2>

        <p className="mt-2 max-w-lg text-[12px] leading-5 text-[rgba(234,228,216,0.76)]">
          {description}
        </p>

        <div className="my-5 h-px w-full bg-white/[0.08]" />

        <ul className="space-y-3">
          {bullets.map((bullet) => (
            <li
              key={bullet}
              className="flex items-start gap-3 text-[12px] leading-5 text-[rgba(234,228,216,0.82)]"
            >
              <span
                className={[
                  'mt-0.5 flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border',
                  checkClass,
                ].join(' ')}
              >
                <CheckIcon />
              </span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>

        <StepStrip accent={accent} steps={steps} className={stepPanelClass} />

        <Link
          href={href}
          className={[
            'mt-5 flex h-10 w-full items-center justify-center gap-3 rounded-[5px] border',
            'text-[12px] font-semibold tracking-[0.01em] transition-all duration-200',
            ctaClass,
          ].join(' ')}
        >
          {cta}
          <span className="transition-transform duration-200 group-hover:translate-x-1">
            →
          </span>
        </Link>

        <p className="mt-4 text-center text-[12px] leading-5 text-[rgba(234,228,216,0.62)]">
          {footer}
        </p>
      </div>
    </article>
  );
}

function StepStrip({
  accent,
  steps,
  className,
}: {
  accent: Accent;
  steps: Array<{
    number: string;
    title: string;
    body: string;
  }>;
  className: string;
}) {
  const isGold = accent === 'gold';

  return (
    <div
      className={[
        'mt-5 rounded-[5px] border px-3 py-4',
        'grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr]',
        className,
      ].join(' ')}
    >
      {steps.map((step, index) => (
        <div key={step.number} className="contents">
          <div className="text-center">
            <div
              className={[
                'mx-auto mb-1.5 flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[9px]',
                isGold
                  ? 'border-[#E4D21D]/45 text-[#F4E23A]'
                  : 'border-emerald-400/45 text-emerald-300',
              ].join(' ')}
            >
              {step.number}
            </div>

            <div
              className={[
                'font-mono text-[9.5px] font-semibold',
                isGold ? 'text-[#F4E23A]' : 'text-emerald-300',
              ].join(' ')}
            >
              {step.title}
            </div>

            <div className="mx-auto mt-1.5 max-w-[105px] text-[9.5px] leading-4 text-[rgba(234,228,216,0.58)]">
              {step.body}
            </div>
          </div>

          {index < steps.length - 1 ? (
            <div
              className={[
                'hidden items-center justify-center text-[22px] sm:flex',
                isGold ? 'text-[#F4E23A]' : 'text-emerald-300',
              ].join(' ')}
            >
              ›
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function EscrowIcon() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4 4.5 7.5 12 11l7.5-3.5L12 4Z" />
      <path d="m4.5 12 7.5 3.5 7.5-3.5" />
      <path d="m4.5 16.5 7.5 3.5 7.5-3.5" />
    </svg>
  );
}

function A2AIcon() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.5 8.5h-1a3.5 3.5 0 0 0 0 7h1" />
      <path d="M15.5 8.5h1a3.5 3.5 0 0 1 0 7h-1" />
      <path d="M8.5 12h7" />
      <path d="M12 5v3" />
      <path d="M12 16v3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m2.5 6.1 2.2 2.2 4.8-5" />
    </svg>
  );
}
