'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { AgentBridgeFlowDiagram, BridgeReceiptsPanel, ExternalJobsPanel, type BridgeSession } from '@/components/agent-bridge';
import { RegisteredAgentsList } from '@/components/a2a/RegisteredAgentsList';
import { getAgentCategory } from '../categories';
import { eventType, roleLabel, shortHash } from '@/components/agent-bridge/types';

type LatestResponse = { ok: boolean; session: BridgeSession | null; error?: string; message?: string };

type PageProps = { params: Promise<{ category: string }> };

function eventCategory(event: { category?: string | null; metadata?: Record<string, unknown> | null }) {
  if (event.category) return event.category;
  const value = event.metadata?.category;
  return typeof value === 'string' ? value : null;
}

export default function LiveA2AAgentCategoryPage({ params }: PageProps) {
  const { category: categoryKey } = use(params);
  const category = getAgentCategory(categoryKey);
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
    const id = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const categoryEvents = useMemo(() => {
    return (session?.events ?? []).filter((event) => eventCategory(event) === categoryKey);
  }, [session, categoryKey]);

  if (!category) {
    return (
      <main className="min-h-screen bg-[#050505] px-4 py-12 text-[#EAE4D8]">
        <div className="mx-auto max-w-3xl rounded-sm border border-white/10 bg-black/30 p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Unknown Category</div>
          <h1 className="mt-2 text-2xl font-black uppercase tracking-[0.14em]">Category not found</h1>
          <Link href="/live-a2a-agent" className="mt-4 inline-flex rounded-sm border border-[#C5A67C]/35 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C]">Back to marketplace →</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-5 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto flex max-w-[1480px] flex-col gap-6 pt-8 pb-12 sm:pt-12">
        <header className="rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C] hover:text-[#F5F0E5]">← A2A Agent Bridge</Link>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">Agent Category</div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5] sm:text-4xl">{category.label}</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-[#EAE4D8]/70">{category.tagline}</p>
            </div>
            <Link href={`/register/autonomous?category=${encodeURIComponent(category.key)}`} className="rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15">
              Register External Bot →
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {category.capabilities.map((capability) => (
              <span key={capability} className="rounded-sm border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-[#EAE4D8]/55">{capability}</span>
            ))}
          </div>
        </header>

        <RegisteredAgentsList categoryKey={category.key} categoryLabel={category.label} />
        <ExternalJobsPanel categoryKey={category.key} title="Open Jobs" />

        <section className="rounded-sm border border-white/10 bg-black/25 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Latest Bridge Events</div>
              <p className="mt-1 text-sm text-[#EAE4D8]/60">Events for this category from top-level category or metadata.category.</p>
            </div>
            <span className="rounded-sm border border-white/10 px-2 py-1 font-mono text-[10px] text-[#EAE4D8]/60">{categoryEvents.length} events</span>
          </div>
          {error ? (
            <div className="rounded-sm border border-red-400/25 bg-red-950/20 p-4 text-sm text-red-200">Bridge session endpoint failed: {error}</div>
          ) : categoryEvents.length === 0 ? (
            <div className="rounded-sm border border-dashed border-white/10 p-4 text-sm text-[#EAE4D8]/55">No bridge events tagged with category={category.key} yet.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {categoryEvents.map((event) => (
                <article key={event.id} className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                    <span className="text-[#F5F0E5]">{roleLabel(event.role)}</span>
                    <span className="text-[#C5A67C]">{eventType(event)}</span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-[#EAE4D8]/55">
                    <div>agent: <span className="font-mono text-[#C5A67C]">{shortHash(event.agent_id)}</span></div>
                    <div>hash: <span className="font-mono text-[#C5A67C]">{shortHash(event.payload_hash)}</span></div>
                    <div>time: <span className="font-mono text-[#C5A67C]">{new Date(event.created_at).toLocaleString()}</span></div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <AgentBridgeFlowDiagram session={session} />
        <BridgeReceiptsPanel session={session} />
      </div>
    </main>
  );
}
