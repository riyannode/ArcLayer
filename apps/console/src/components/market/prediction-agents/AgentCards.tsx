'use client';

import {
  normalizePredictionAgents,
  orderPredictionAgentsByFlow,
  type PredictionAgentInput,
  type PredictionAgentView,
} from './predictionAgentTypes';
import { BotStatusPill } from '@/components/agent/BotStatusPill';

export default function AgentCards({ agents }: { agents: PredictionAgentInput[] }) {
  const cards = orderPredictionAgentsByFlow(normalizePredictionAgents(agents));

  return (
    <section className="rounded-2xl border border-zinc-800/80 bg-[#080808] p-5">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-orange-400/80">Agent Cards</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-zinc-100">Registered Prediction Bots</h2>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">{cards.length} cards</div>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/50 p-5 text-center text-sm text-zinc-500">
          No registered prediction-market-bots found.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {cards.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </section>
  );
}

function AgentCard({ agent }: { agent: PredictionAgentView }) {
  const isLive = agent.status === 'active';
  const hasTx = Boolean(agent.txHref && agent.tx !== '—');
  const hasReasoning = agent.reasoningSummary !== '—' || agent.reasoningWhy !== '—' || agent.reasoningSource !== '—';

  return (
    <article className="rounded-xl border border-zinc-800 bg-[#0d0d0f] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)] transition hover:border-orange-500/35 hover:bg-[#111114]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-zinc-100">{agent.name}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-orange-300">{agent.role}</div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={[
              'h-2.5 w-2.5 rounded-full',
              agent.proofActive ? 'bg-sky-400 shadow-[0_0_14px_rgba(56,189,248,0.9)]' : 'bg-zinc-700',
            ].join(' ')}
            title={`bridge proof: ${agent.proof}`}
          />
          <span
            className={[
              'h-2.5 w-2.5 rounded-full',
              agent.activityActive ? 'animate-pulse bg-orange-400 shadow-[0_0_14px_rgba(251,146,60,0.9)]' : 'bg-zinc-700',
            ].join(' ')}
            title={`activity: ${agent.activity}`}
          />
          <span
            className={[
              'rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em]',
              isLive ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-zinc-700 bg-zinc-900 text-zinc-500',
            ].join(' ')}
          >
            {agent.status}
          </span>
          {agent.id && <BotStatusPill agentId={agent.id} compact />}
        </div>
      </div>

      <div className="mt-4 space-y-2 font-mono text-[10px] text-zinc-500">
        <Row label="event" value={agent.event} />
        <LinkedRow label="pulse" value={agent.activityActive ? agent.activity : 'idle'} href={agent.activityHref} />
        {hasTx ? <LinkedRow label="tx" value={agent.tx} href={agent.txHref} /> : null}
        {agent.proofHash !== '—' ? <LinkedRow label="proof" value={agent.proofHash} href={agent.proofHashHref} /> : <Row label="proof" value={agent.proofActive ? agent.proof : 'none'} />}
        {hasReasoning ? <Row label="llm" value={`${agent.reasoningFallback ? 'fallback' : 'llm'} · ${agent.reasoningSource}`} /> : null}
        {agent.reasoningWhy !== '—' ? <Row label="why" value={agent.reasoningWhy} /> : null}
        <Row label="seen" value={agent.seen} />
      </div>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
      <span className="uppercase tracking-[0.16em] text-zinc-700">{label}</span>
      <span className="truncate text-zinc-400" title={value}>{value || '—'}</span>
    </div>
  );
}

function LinkedRow({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
      <span className="uppercase tracking-[0.16em] text-zinc-700">{label}</span>
      {href ? (
        <a className="truncate text-orange-300 hover:text-orange-200" href={href} target="_blank" rel="noreferrer" title={value}>
          {value || '—'}
        </a>
      ) : (
        <span className="truncate text-zinc-400" title={value}>{value || '—'}</span>
      )}
    </div>
  );
}
