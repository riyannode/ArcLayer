'use client';

import Link from 'next/link';
import type { AgentCategory } from '@/app/live-a2a-agent/categories';

type Props = {
  category: AgentCategory;
};

export function A2ACategoryPageView({ category }: Props) {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-10 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_14%_0%,rgba(197,166,124,0.12),transparent_32%),radial-gradient(circle_at_86%_8%,rgba(255,255,255,0.05),transparent_28%)]" />
      <div className="relative mx-auto max-w-6xl space-y-5 pb-12">
        <header className="rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">← A2A Agent Bridge</Link>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">Agent Category</div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5] sm:text-4xl">{category.label}</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-[#EAE4D8]/70">{category.tagline}</p>
            </div>
            <div className="flex gap-2">
              <Link href={`/live-a2a-agent/jobs?category=${encodeURIComponent(category.key)}`} className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C]">Open Jobs →</Link>
              <Link href={`/register/external-bot?category=${encodeURIComponent(category.key)}`} className="rounded-sm border border-white/10 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/75 hover:border-[#C5A67C]/35 hover:text-[#C5A67C]">Register External Bot →</Link>
            </div>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-sm border border-white/10 bg-black/25 p-4 lg:col-span-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Category-Specific Flow</div>
            <h2 className="mt-2 text-lg font-semibold uppercase tracking-[0.08em] text-[#F5F0E5]">{category.pageFlow.title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#EAE4D8]/70">{category.pageFlow.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {category.pageFlow.nodes.map((node, index) => (
                <div key={node} className="flex items-center gap-2">
                  <span className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[#C5A67C]">{node}</span>
                  {index < category.pageFlow.nodes.length - 1 ? <span className="text-[#EAE4D8]/35">→</span> : null}
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-sm border border-white/10 bg-black/25 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Status</div>
            <div className="mt-3 inline-flex rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-300">{category.status}</div>
            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#EAE4D8]/55">Fee Range</div>
              <p className="mt-1 text-sm text-[#EAE4D8]/80">{category.feeRange}</p>
            </div>
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-sm border border-white/10 bg-black/25 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Capabilities</div>
            <ul className="mt-3 space-y-2">
              {category.capabilities.map((capability) => (
                <li key={capability} className="rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-[#EAE4D8]/75">{capability}</li>
              ))}
            </ul>
          </article>
          <article className="rounded-sm border border-white/10 bg-black/25 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Example Agents</div>
            <ul className="mt-3 space-y-2">
              {category.exampleAgents.map((agent) => (
                <li key={agent} className="rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-[#EAE4D8]/75">{agent}</li>
              ))}
            </ul>
          </article>
        </section>
      </div>
    </main>
  );
}
