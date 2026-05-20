'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { filterAgentsByCategory, type RegistryAgent } from '@/lib/a2a/category-filter';

function short(value: string) {
  if (!value || value.length < 12) return value || '—';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function categoryRoleLabel(agent: RegistryAgent) {
  return agent.metadata?.role || agent.role || 'Autonomous Agent';
}

function capabilities(agent: RegistryAgent) {
  if (Array.isArray(agent.metadata?.capability) && agent.metadata.capability.length > 0) {
    return agent.metadata.capability.slice(0, 3);
  }
  return [agent.role || 'A2A Service', 'x402 Ready', 'Registry Synced'];
}

function AgentCard({ agent }: { agent: RegistryAgent }) {
  const name = agent.metadata?.name || `Agent ${short(agent.agentId)}`;
  const description = agent.metadata?.description || 'Registered A2A autonomous agent discovered from AgentRegistry.';
  const caps = capabilities(agent);

  return (
    <article className="rounded-sm border border-white/10 bg-black/25 p-4 transition hover:border-[#C5A67C]/35 hover:bg-[#C5A67C]/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[#C5A67C]/25 bg-[#C5A67C]/10 font-mono text-sm text-[#C5A67C]">
              {agent.metadata?.avatar ? '●' : '◇'}
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-mono text-sm font-bold uppercase tracking-[0.12em] text-[#EAE4D8]">{name}</h3>
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/50">{categoryRoleLabel(agent)}</p>
            </div>
          </div>
        </div>
        <span className="shrink-0 rounded-sm border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-emerald-300">
          Registered
        </span>
      </div>

      <p className="mt-3 line-clamp-3 min-h-[54px] text-sm leading-6 text-[#EAE4D8]/65 invisible">{description}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {caps.map((cap) => (
          <span key={cap} className="rounded-sm border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-[#EAE4D8]/55">
            {cap}
          </span>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-[10px]">
        <div className="rounded-sm border border-white/10 bg-[#0A0A0A] p-2">
          <div className="uppercase tracking-[0.16em] text-[#EAE4D8]/40">Controller</div>
          <div className="mt-1 text-[#EAE4D8]/75">{short(agent.owner)}</div>
        </div>
        <div className="rounded-sm border border-white/10 bg-[#0A0A0A] p-2">
          <div className="uppercase tracking-[0.16em] text-[#EAE4D8]/40">Endpoint</div>
          <div className="mt-1 truncate text-[#EAE4D8]/75">{agent.endpoint || 'on-chain only'}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 font-mono text-[10px] text-[#EAE4D8]/45">
        <span className="truncate">ID {short(agent.agentId)}</span>
        <Link href={`/a2a?focus=${encodeURIComponent(agent.agentId)}`} className="shrink-0 rounded-sm border border-[#C5A67C]/30 px-2 py-1 text-[#C5A67C] hover:bg-[#C5A67C]/10">
          View network →
        </Link>
      </div>
    </article>
  );
}

export function RegisteredAgentsList({ categoryKey, categoryLabel }: { categoryKey: string; categoryLabel: string }) {
  const [agents, setAgents] = useState<RegistryAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        const r = await fetch(`/api/a2a/agents?category=${encodeURIComponent(categoryKey)}&t=${Date.now()}`, { cache: 'no-store' });
        const data = await r.json().catch(() => ({ agents: [] }));
        if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
        if (!cancelled) setAgents(Array.isArray(data.agents) ? data.agents : []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load registered agents.');
          setAgents([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    const id = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [categoryKey]);

  const categoryAgents = useMemo(() => filterAgentsByCategory(agents, categoryKey), [agents, categoryKey]);

  return (
    <section className="overflow-hidden rounded-sm border border-white/10 bg-[#0A0A0A]/90">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#C5A67C]">Other Agents in this Category</div>
          <p className="mt-1 text-sm text-[#EAE4D8]/60 invisible">Live registry discovery for {categoryLabel}. Featured demo flow stays pinned above.</p>
        </div>
        <Link href={`/register/autonomous?category=${encodeURIComponent(categoryKey)}`} className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15">
          Register the first agent →
        </Link>
      </div>

      {error ? (
        <div className="p-5 font-mono text-[11px] text-rose-200">Registry fetch failed: {error}</div>
      ) : isLoading ? (
        <div className="p-5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#EAE4D8]/45">Loading registry agents…</div>
      ) : categoryAgents.length === 0 ? (
        <div className="p-6 text-center">
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-[#C5A67C]">No registered {categoryLabel} agents yet</div>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[#EAE4D8]/60 invisible">This category has no non-featured agents from AgentRegistry. Register a self-hosted x402 agent and it appears here after sync.</p>
          <Link href={`/register/autonomous?category=${encodeURIComponent(categoryKey)}`} className="mt-4 inline-flex rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15">
            Register the first agent →
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {categoryAgents.map((agent) => <AgentCard key={agent.agentId} agent={agent} />)}
        </div>
      )}
    </section>
  );
}
