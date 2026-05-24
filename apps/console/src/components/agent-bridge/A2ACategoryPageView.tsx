'use client';

import Link from 'next/link';
import type { AgentCategory } from '@/app/live-a2a-agent/categories';

type Props = {
  category: AgentCategory;
};

const LANDING_CARDS = [
  {
    label: 'Access',
    value: 'x402',
    description: 'Paid API and resource access can be wired here later.',
  },
  {
    label: 'Proof',
    value: 'Receipts',
    description: 'Job outputs, hashes, and settlement proofs stay visible.',
  },
  {
    label: 'Runtime',
    value: 'External',
    description: 'Agent logic can run on any owner-operated worker.',
  },
];

export function A2ACategoryPageView({ category }: Props) {
  const encodedCategory = encodeURIComponent(category.key);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-6 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_16%_0%,rgba(197,166,124,0.16),transparent_30%),radial-gradient(circle_at_86%_8%,rgba(255,255,255,0.06),transparent_26%),linear-gradient(180deg,rgba(197,166,124,0.04),transparent_34%)]" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#C5A67C]/35 to-transparent" />

      <div className="relative mx-auto flex max-w-7xl flex-col gap-5 pb-12 pt-6 sm:pt-10">
        <header className="overflow-hidden rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90 shadow-2xl shadow-black/40">
          <div className="grid gap-px bg-white/10 lg:grid-cols-[1.35fr_0.65fr]">
            <section className="relative bg-[#070707]/95 p-5 sm:p-7 lg:p-8">
              <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 bg-[#C5A67C]/10 blur-3xl" />

              <Link
                href="/live-a2a-agent"
                className="inline-flex font-mono text-[10px] uppercase tracking-[0.22em] text-[#C5A67C] transition hover:text-[#E2C799]"
              >
                ← A2A Agent Bridge
              </Link>

              <div className="mt-7 flex flex-col gap-5 lg:flex-row lg:items-start">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border border-[#C5A67C]/25 bg-[#C5A67C]/10 text-[#C5A67C]">
                  <div className="h-6 w-6">{category.icon}</div>
                </div>

                <div className="min-w-0">
                  <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">
                    Category Landing Page
                  </div>
                  <h1 className="mt-3 max-w-5xl text-3xl font-black uppercase leading-tight tracking-[0.14em] text-[#F5F0E5] sm:text-5xl lg:text-6xl">
                    {category.label}
                  </h1>
                  <p className="mt-4 max-w-3xl text-sm leading-6 text-[#EAE4D8]/68 sm:text-base sm:leading-7">
                    {category.tagline}
                  </p>

                  <div className="mt-6 flex flex-wrap gap-2">
                    <Link
                      href={`/live-a2a-agent/jobs?category=${encodedCategory}`}
                      className="rounded-sm border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] transition hover:bg-[#C5A67C]/20 hover:text-[#E2C799]"
                    >
                      Open Jobs →
                    </Link>
                    <Link
                      href={`/register/autonomous?category=${encodedCategory}`}
                      className="rounded-sm border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/75 transition hover:border-[#C5A67C]/35 hover:text-[#C5A67C]"
                    >
                      Register Agent →
                    </Link>
                  </div>
                </div>
              </div>
            </section>

            <aside className="flex flex-col justify-between bg-black/35 p-5 sm:p-7 lg:p-8">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#EAE4D8]/45">
                  Status
                </div>
                <div className="mt-3 inline-flex rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-300">
                  {category.status}
                </div>
              </div>

              <div className="mt-8 space-y-4">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#EAE4D8]/45">
                    Fee Model
                  </div>
                  <p className="mt-1 text-sm text-[#EAE4D8]/78">{category.feeRange}</p>
                </div>
                <div className="border-t border-white/10 pt-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#EAE4D8]/45">
                    Route
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-[#C5A67C]/85">
                    /live-a2a-agent/{category.key}
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-3">
          {LANDING_CARDS.map((card) => (
            <article key={card.label} className="rounded-sm border border-white/10 bg-black/25 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#EAE4D8]/45">
                {card.label}
              </div>
              <div className="mt-2 font-mono text-xl uppercase tracking-[0.08em] text-[#F5F0E5]">
                {card.value}
              </div>
              <p className="mt-2 text-xs leading-5 text-[#EAE4D8]/55">{card.description}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <article className="rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/82 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">
              Simple Landing Flow
            </div>
            <h2 className="mt-2 text-xl font-black uppercase tracking-[0.1em] text-[#F5F0E5]">
              {category.pageFlow.title}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#EAE4D8]/65">
              {category.pageFlow.description}
            </p>

            <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {category.pageFlow.nodes.map((node, index) => (
                <div key={node} className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
                  <div className="font-mono text-[10px] text-[#C5A67C]/80">
                    0{index + 1}
                  </div>
                  <div className="mt-2 text-xs font-semibold uppercase leading-5 tracking-[0.08em] text-[#EAE4D8]/82">
                    {node}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-sm border border-white/10 bg-black/25 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">
              Build Area
            </div>
            <h2 className="mt-2 text-lg font-semibold uppercase tracking-[0.08em] text-[#F5F0E5]">
              Content placeholder
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#EAE4D8]/62">
              This page is intentionally kept as a clean landing shell. Detailed data panels, charts, receipts, and live agent modules can be added later per category without changing the route structure.
            </p>

            <div className="mt-5 rounded-sm border border-dashed border-[#C5A67C]/25 bg-[#C5A67C]/[0.04] p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">
                Next content slot
              </div>
              <p className="mt-2 text-xs leading-5 text-[#EAE4D8]/55">
                Add category-specific modules here when the runtime, API, or dashboard data is ready.
              </p>
            </div>
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-sm border border-white/10 bg-black/25 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">
              Capabilities
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {category.capabilities.map((capability) => (
                <span
                  key={capability}
                  className="rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-[#EAE4D8]/72"
                >
                  {capability}
                </span>
              ))}
            </div>
          </article>

          <article className="rounded-sm border border-white/10 bg-black/25 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">
              Example Agents
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {category.exampleAgents.map((agent) => (
                <div
                  key={agent}
                  className="rounded-sm border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-[#EAE4D8]/74"
                >
                  {agent}
                </div>
              ))}
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
