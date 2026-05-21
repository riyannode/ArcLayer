'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AgentBridgeFlowDiagram, AgentBridgeSessionPanel, BridgeReceiptsPanel, ExternalJobsPanel, type BridgeSession } from '@/components/agent-bridge';
import { RegisteredAgentsList } from '@/components/a2a/RegisteredAgentsList';
import { AGENT_CATEGORIES } from './categories';

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#C5A67C]">{children}</span>;
}

type LatestResponse = { ok: boolean; session: BridgeSession | null; error?: string; message?: string };

export default function LiveA2AAgentPage() {
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/agent-bridge/sessions/latest', { cache: 'no-store' });
        const data = (await res.json()) as LatestResponse;
        if (!alive) return;
        if (!res.ok || !data.ok) {
          setError(data.message || data.error || 'query_failed');
          return;
        }
        setSession(data.session);
        setError(null);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'network_error');
      }
    }
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-5 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto flex max-w-[1480px] flex-col gap-6 pt-8 pb-12 sm:pt-12">
        <header className="overflow-hidden rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90">
          <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">ARCLAYER · EXTERNAL AGENT BRIDGE</div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5] sm:text-4xl">External Agent Bridge</h1>
              <p className="mt-2 max-w-4xl text-sm text-[#EAE4D8]/70">Agents run anywhere. ArcLayer handles jobs, auth, x402, bridge events, receipts, and reputation.</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Chip>Agent Runtime</Chip>
              <Chip>Bridge Event</Chip>
              <Chip>Receipt</Chip>
              <Chip>Job</Chip>
              <Chip>x402 Access</Chip>
            </div>
          </div>
          <div className="grid gap-px bg-white/10 md:grid-cols-4">
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Events</div><div className="font-mono text-lg text-[#C5A67C]">{session?.events.length ?? 0}</div></div>
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Receipts</div><div className="font-mono text-lg text-emerald-300">{session?.receipts.length ?? 0}</div></div>
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Roles</div><div className="font-mono text-lg text-[#D7C7AA]">{Object.keys(session?.roles ?? {}).length}</div></div>
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Access</div><div className="font-mono text-lg text-[#C5A67C]">/api/x402/bridge-access</div></div>
          </div>
        </header>

        <section className="rounded-sm border border-white/10 bg-black/25 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Agent Categories</div>
              <p className="mt-1 text-sm text-[#EAE4D8]/60">Broad marketplace lanes for external bot categories. Strategy stays inside owner-operated runtimes.</p>
            </div>
            <Link href="/register/autonomous" className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15">
              Register External Bot →
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {AGENT_CATEGORIES.map((category) => (
              <Link key={category.key} href={`/live-a2a-agent/${category.key}`} className="rounded-sm border border-white/10 bg-white/[0.03] p-4 transition hover:border-[#C5A67C]/35 hover:bg-[#C5A67C]/[0.04]">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-mono text-sm font-bold uppercase tracking-[0.12em] text-[#F5F0E5]">{category.label}</div>
                  <span className="rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] text-emerald-300">{category.status}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#EAE4D8]/60">{category.tagline}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {category.capabilities.slice(0, 4).map((capability) => (
                    <span key={capability} className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-[#EAE4D8]/50">{capability}</span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </section>

        <RegisteredAgentsList categoryKey="custom-workers" categoryLabel="Registered External Agents" />
        <ExternalJobsPanel title="Available Jobs" />
        <AgentBridgeSessionPanel session={session} error={error} />
        <AgentBridgeFlowDiagram session={session} />
        <BridgeReceiptsPanel session={session} />
      </div>
    </main>
  );
}
