'use client';

import type { BackendAgentLike } from './predictionAgentTypes';
import { normalizeAgents } from './predictionAgentTypes';

const STEPS = ['intent', 'signal', 'risk', 'execution', 'receipt'];

export default function NodeGraph({ agents, activeStepIndex = 4 }: { agents: BackendAgentLike[]; activeStepIndex?: number }) {
  const normalizedAgents = normalizeAgents(agents);
  const liveAgents = normalizedAgents.filter((agent) => agent.status === 'synced' || agent.status === 'active').length;

  return (
    <section className="rounded-xl border border-[#1b1c23] bg-[#05060a]/95 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_20px_70px_rgba(0,0,0,0.35)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#ff9100]">Live Node Graph</div>
          <div className="mt-1 text-xs text-zinc-500">A2A prediction-market decision flow synced from existing backend APIs</div>
        </div>
        <div className="flex gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-emerald-300">{liveAgents} live</span>
          <span className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-zinc-500">{normalizedAgents.length} agents</span>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-lg border border-[#1b1c23] bg-[#090a0f]/80 p-4">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,145,0,0.11),transparent_30%),radial-gradient(circle_at_70%_60%,rgba(16,185,129,0.08),transparent_28%)]" />
        <div className="relative grid gap-3 md:grid-cols-5">
          {STEPS.map((step, index) => {
            const active = index <= activeStepIndex;
            return (
              <div key={step} className="relative rounded-lg border border-[#20222b] bg-[#05060a]/85 p-3">
                <div className={active ? 'mb-2 h-1 rounded-full bg-[#ff9100]' : 'mb-2 h-1 rounded-full bg-zinc-800'} />
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">step {index + 1}</div>
                <div className={active ? 'mt-1 text-sm font-semibold uppercase tracking-[0.12em] text-zinc-100' : 'mt-1 text-sm font-semibold uppercase tracking-[0.12em] text-zinc-600'}>{step}</div>
                <div className="mt-2 text-[11px] leading-relaxed text-zinc-500">{describeStep(step)}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {normalizedAgents.slice(0, 3).map((agent) => (
          <div key={agent.id} className="rounded-lg border border-[#20222b] bg-[#090a0f]/75 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-xs font-semibold text-zinc-200">{agent.name}</div>
              <span className={agent.status === 'synced' || agent.status === 'active' ? 'h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.85)]' : 'h-2 w-2 rounded-full bg-zinc-700'} />
            </div>
            <div className="mt-2 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-[#ff9100]">{agent.role}</div>
            <div className="mt-2 truncate text-[11px] text-zinc-500">{agent.event}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function describeStep(step: string) {
  if (step === 'intent') return 'external bot posts registered trading intent';
  if (step === 'signal') return 'market signal is consumed from live page data';
  if (step === 'risk') return 'agent confidence and limits are evaluated';
  if (step === 'execution') return 'decision payload moves through A2A bridge';
  return 'receipt and event history stay synced';
}
