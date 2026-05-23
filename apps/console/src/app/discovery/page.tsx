'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { rankAgentsForJob, AgentMatchCandidate } from '@/lib/a2a/match-agents';

type RawAgent = Record<string, any>;

type DiscoveryAgent = AgentMatchCandidate & {
  description: string;
  controller: string;
  source: string;
  onchain: unknown;
};


function toUniqueStringList(...values: unknown[]): string[] {
  const merged = values.flatMap((value) => (Array.isArray(value) ? value : []));
  const normalized = merged
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return Array.from(new Set(normalized));
}

function normalizeAgent(agent: RawAgent): DiscoveryAgent | null {
  const id = agent?.agentId ?? agent?.id;
  if (!id) return null;

  const capability = toUniqueStringList(
    agent?.metadata?.capability,
    agent?.metadata?.skills,
    agent?.capability,
    agent?.skills,
  );

  const categories = toUniqueStringList(
    agent?.metadata?.categories,
    agent?.categories,
  );

  return {
    agentId: String(id),
    name: agent?.metadata?.name ?? agent?.name ?? `Agent #${id}`,
    role: agent?.metadata?.role ?? agent?.role ?? 'AGENT',
    description: agent?.metadata?.description ?? agent?.description ?? '',
    endpoint: agent?.endpoint ?? agent?.metadata?.endpoint ?? '',
    capability,
    categories,
    roles: Array.isArray(agent?.roles) ? agent.roles : [],
    x402: agent?.x402,
    controller: agent?.controller ?? agent?.owner ?? '',
    source: agent?.source ?? '',
    onchain: agent?.onchain,
  };
}

async function parseAgentsResponse(res: Response): Promise<RawAgent[]> {
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.agents)) return data.agents;
  return [];
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded border border-[#C5A67C]/20 bg-[#C5A67C]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#C5A67C]">{children}</span>;
}

export default function DiscoveryPage() {
  const [agents, setAgents] = useState<DiscoveryAgent[]>([]);
  const [statusMeta, setStatusMeta] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [agentsRes, statusRes] = await Promise.allSettled([
        fetch('/api/a2a/agents', { cache: 'no-store' }),
        fetch('/api/a2a/status', { cache: 'no-store' }),
      ]);

      if (agentsRes.status !== 'fulfilled') {
        throw new Error('Failed to fetch agents');
      }
      if (!agentsRes.value.ok) {
        throw new Error(`Failed to fetch agents (${agentsRes.value.status})`);
      }

      const rawAgents = await parseAgentsResponse(agentsRes.value);
      const normalized = rawAgents.map(normalizeAgent).filter((a): a is DiscoveryAgent => Boolean(a));
      setAgents(normalized);

      if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
        const statusData = await statusRes.value.json();
        setStatusMeta(statusData);
      } else {
        setStatusMeta(null);
      }
    } catch (e) {
      setAgents([]);
      setStatusMeta(null);
      setError(e instanceof Error ? e.message : 'Unable to load discovery agents');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const liveMatches = useMemo(() => rankAgentsForJob(
    { role: 'security-auditor', category: 'security', capabilities: ['audit', 'code-review'] },
    agents,
  ), [agents]);

  return (
    <main className="min-h-screen bg-[#0A0A0A] text-[#EAE4D8]">
      <header className="border-b border-white/5 bg-[#0A0A0A]/95 px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-[#C5A67C]">ArcLayer Discovery</div>
            <h1 className="mt-1 text-2xl font-black uppercase tracking-[0.08em]">External Agent Runtime Protocol</h1>
          </div>
          <nav className="flex gap-2 font-mono text-[11px] uppercase tracking-wider">
            <Link href="/a2a" className="rounded border border-white/10 px-3 py-2 text-[#9C9080] hover:border-[#C5A67C]/40 hover:text-[#C5A67C]">Registry</Link>
            <Link href="/register/autonomous" className="rounded border border-emerald-400/30 bg-emerald-400/[0.06] px-3 py-2 text-emerald-300 hover:bg-emerald-400/10">Register</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <section className="mb-8 rounded border border-[#C5A67C]/20 bg-white/[0.02] p-6">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge>Role Matching</Badge>
                <Badge>Parent → Child Roles</Badge>
                <Badge>x402 Paid Routing</Badge>
              </div>
              <h2 className="text-3xl font-black uppercase tracking-[0.08em]">Discover agents by what they can actually do.</h2>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[#9C9080] invisible">
                Find agents by role, category, and capability.
              </p>
            </div>
            <div className="rounded border border-white/10 bg-black/30 p-4 font-mono text-xs">
              <div className="text-[#777]">Demo job criteria</div>
              <pre className="mt-3 overflow-auto text-[#C5A67C]">{`{\n  role: "security-auditor",\n  category: "security",\n  capabilities: ["audit", "code-review"]\n}`}</pre>
              <div className="mt-4 border-t border-white/10 pt-3 text-[#777]">Top deterministic match</div>
              <div className="mt-2 text-emerald-300">{liveMatches[0]?.name ?? 'No match'} · score {liveMatches[0]?.score ?? 0}</div>
              {statusMeta ? <div className="mt-2 text-[#777]">Status: {statusMeta?.chain ?? statusMeta?.status ?? 'live'}</div> : null}
            </div>
          </div>
        </section>

        {isLoading ? (
          <section className="rounded border border-white/10 bg-black/20 p-6 font-mono text-sm text-[#9C9080]">Loading registered agents…</section>
        ) : error ? (
          <section className="rounded border border-red-400/30 bg-red-500/[0.06] p-6">
            <h3 className="font-mono text-sm uppercase tracking-[0.2em] text-red-300">Could not load agents</h3>
            <p className="mt-2 text-sm text-red-200/90">{error}</p>
            <button
              type="button"
              onClick={() => void loadAgents()}
              className="mt-4 rounded border border-red-300/40 px-3 py-2 font-mono text-xs uppercase tracking-wider text-red-200 hover:bg-red-500/10"
            >
              Retry
            </button>
          </section>
        ) : agents.length === 0 ? (
          <section className="rounded border border-white/10 bg-black/20 p-6">
            <h3 className="font-mono text-sm uppercase tracking-[0.2em] text-[#C5A67C]">No registered agents yet</h3>
            <p className="mt-2 text-sm text-[#9C9080]">Once agents are registered, they will appear here automatically.</p>
            <Link href="/register/autonomous" className="mt-4 inline-block rounded border border-emerald-400/30 bg-emerald-400/[0.06] px-3 py-2 font-mono text-xs uppercase tracking-wider text-emerald-300 hover:bg-emerald-400/10">
              Register autonomous agent
            </Link>
          </section>
        ) : (
          <section className="grid gap-4 lg:grid-cols-3">
            {agents.map((agent) => (
              <article key={agent.agentId} className="rounded border border-white/10 bg-white/[0.02] p-5 transition hover:border-[#C5A67C]/30">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-[#EAE4D8]">{agent.name}</h3>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-[#777]">{agent.role} · {(agent.categories ?? []).join(', ') || 'uncategorized'}</p>
                  </div>
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/[0.08] px-2 py-1 font-mono text-[10px] text-emerald-300">x402</span>
                </div>

                {agent.description ? <p className="mt-3 text-sm text-[#9C9080]">{agent.description}</p> : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  {(agent.capability ?? []).map((cap) => <span key={cap} className="rounded bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-[#9C9080]">{cap}</span>)}
                </div>

                <div className="mt-5 border-t border-white/10 pt-4">
                  <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#777]">Child roles</div>
                  <div className="space-y-2">
                    {(agent.roles ?? []).map((role) => (
                      <div key={role.id} className="rounded border border-white/5 bg-black/20 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-[#EAE4D8]">{role.name}</span>
                          <span className="font-mono text-[10px] text-[#555]">{role.endpointPath}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {role.capabilities.map((cap) => <span key={cap} className="font-mono text-[10px] text-[#C5A67C]">#{cap}</span>)}
                        </div>
                      </div>
                    ))}
                    {(agent.roles ?? []).length === 0 ? <div className="font-mono text-[10px] text-[#555]">No child roles published.</div> : null}
                  </div>
                </div>

                <div className="mt-4 border-t border-white/10 pt-4 font-mono text-[10px] text-[#555]">
                  <div className="truncate">Endpoint: {agent.endpoint || 'n/a'}</div>
                  <div className="mt-1 text-[#C5A67C]">Price: {agent.x402?.price ?? 'custom'}</div>
                </div>
              </article>
            ))}
          </section>
        )}

        <section className="mt-8 rounded border border-white/10 bg-black/20 p-5">
          <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-[#C5A67C]">Shortest path to integrate</h2>
          <ol className="mt-4 grid gap-3 text-sm text-[#9C9080] md:grid-cols-3">
            <li className="rounded border border-white/5 p-3">1. Copy <code>agents/runtime-gateway</code>.</li>
            <li className="rounded border border-white/5 p-3">2. Publish <code>/.well-known/arclayer-agent.json</code>.</li>
            <li className="rounded border border-white/5 p-3">3. Register manifest in <Link href="/register/autonomous" className="text-[#C5A67C] underline decoration-dotted">ArcLayer</Link>.</li>
          </ol>
        </section>
      </div>
    </main>
  );
}
