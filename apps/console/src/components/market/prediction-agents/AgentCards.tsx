'use client';

import type { AgentNode, BackendAgentLike } from './predictionAgentTypes';
import { normalizeAgents } from './predictionAgentTypes';

export default function AgentCards({ agents }: { agents: BackendAgentLike[] }) {
  const normalizedAgents = normalizeAgents(agents);

  return (
    <section className="rounded-xl border border-[#1b1c23] bg-[#05060a]/95 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_20px_70px_rgba(0,0,0,0.35)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#ff9100]">Prediction Agent Cards</div>
          <div className="mt-1 text-xs text-zinc-500">External bots registered into prediction-market-bots</div>
        </div>
        <div className="rounded-full border border-[#ff9100]/20 bg-[#ff9100]/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#ffb86b]">
          {normalizedAgents.length} nodes
        </div>
      </div>

      {normalizedAgents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-[#090a0f]/80 p-4 text-center font-mono text-[11px] text-zinc-500">
          No local registered agents found.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
          {normalizedAgents.map((agent) => <AgentCard key={agent.id} agent={agent} />)}
        </div>
      )}
    </section>
  );
}

function AgentCard({ agent }: { agent: AgentNode }) {
  const isPaid = agent.category === 'paid' || agent.paymentMode === 'paid';
  const isSynced = agent.status === 'synced' || agent.status === 'active';

  return (
    <article className="group overflow-hidden rounded-lg border border-[#20222b] bg-[#090a0f]/90 p-3.5 shadow-md transition-all duration-200 hover:border-[#ff9100]/40 hover:bg-[#12141c]/90 hover:shadow-[0_0_24px_rgba(255,145,0,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">{agent.name}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#ff9100]">{agent.role}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={isSynced ? 'h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.85)]' : 'h-2 w-2 rounded-full bg-zinc-700'} />
          <span className={isPaid ? 'rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-mono text-[9px] text-emerald-300' : 'rounded-full border border-[#ff9100]/25 bg-[#ff9100]/10 px-2 py-0.5 font-mono text-[9px] text-[#ffb86b]'}>
            {isPaid ? 'paid' : 'x402'}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-2 font-mono text-[10px] text-zinc-500">
        <Meta label="id" value={agent.id} />
        <Meta label="endpoint" value={agent.endpoint} />
        <Meta label="caps" value={agent.caps} />
        <Meta label="event" value={agent.event} strong />
        <Meta label="seen" value={agent.seen} />
      </div>
    </article>
  );
}

function Meta({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-2">
      <span className="uppercase tracking-[0.16em] text-zinc-600">{label}</span>
      <span className={strong ? 'truncate text-zinc-300' : 'truncate text-zinc-500'}>{value || '—'}</span>
    </div>
  );
}
