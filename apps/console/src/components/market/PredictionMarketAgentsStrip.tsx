'use client';

import { useEffect, useState } from 'react';

type Agent = {
  agentId: string;
  name: string;
  role: string;
  endpoint?: string | null;
  categories: string[];
  roles?: Array<{ id: string; name: string; category: string; capabilities: string[] }>;
  capabilities: string[];
  x402?: { enabled?: boolean; price?: string } | null;
  updatedAt?: string;
};

function short(v?: string | null) {
  if (!v) return '—';
  return v.length > 24 ? `${v.slice(0, 14)}…${v.slice(-6)}` : v;
}

function syncedLabel(updatedAt?: string) {
  if (!updatedAt) return 'unsynced';
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return 'unsynced';
  return `synced ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function PredictionMarketAgentsStrip({
  category = 'prediction-market-bots',
}: {
  category?: string;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const res = await fetch(`/api/a2a/agents/by-category?category=${encodeURIComponent(category)}`, {
          cache: 'no-store',
        });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok || !json.ok) throw new Error(json.error || 'agents_fetch_failed');
        setAgents(Array.isArray(json.agents) ? json.agents : []);
        setError(null);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'agents_fetch_failed');
      }
    }

    void load();

    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);

    const onVisible = () => {
      if (!document.hidden) void load();
    };

    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [category]);

  return (
    <section className="rounded-xl border border-white/10 bg-[#0A0A0A]/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">
            Registered Prediction Agents
          </div>
          <div className="mt-1 text-xs text-[#EAE4D8]/55">{agents.length} registered for {category}</div>
        </div>

        <a
          href="/register/autonomous?category=prediction-market-bots"
          className="rounded-sm border border-[#C5A67C]/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#C5A67C]"
        >
          Register Bot →
        </a>
      </div>

      {error ? (
        <div className="rounded border border-red-400/20 bg-red-950/20 p-2 text-xs text-red-200">{error}</div>
      ) : agents.length === 0 ? (
        <div className="rounded border border-dashed border-white/10 bg-white/[0.02] p-3 text-center font-mono text-[11px] text-[#81796E]">
          No prediction market agents registered yet.
        </div>
      ) : (
        <div className="flex max-h-[210px] gap-2 overflow-x-auto pb-1">
          {agents.map((agent) => (
            <article key={agent.agentId} className="min-w-[185px] max-w-[215px] rounded border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[#F5F0E5]">{agent.name || short(agent.agentId)}</div>
                  <div className="mt-1 truncate font-mono text-[10px] uppercase text-[#81796E]">{agent.role || agent.roles?.[0]?.name || 'agent'}</div>
                </div>

                <span className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 font-mono text-[9px] text-emerald-300">
                  {agent.x402?.enabled ? 'x402' : 'reg'}
                </span>
              </div>

              <div className="mt-3 space-y-1 font-mono text-[10px] text-[#8A8378]">
                <div className="truncate">id {short(agent.agentId)}</div>
                <div className="truncate">endpoint {short(agent.endpoint)}</div>
                <div className="truncate">caps {(agent.capabilities || []).slice(0, 2).join(', ') || '—'}</div>
                <div className="truncate text-[#A69D90]">{syncedLabel(agent.updatedAt)}</div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
