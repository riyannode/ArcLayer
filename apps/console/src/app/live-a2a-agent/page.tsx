'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BridgeSession } from '@/components/agent-bridge';
import { AGENT_CATEGORIES } from './categories';
import { safeJson } from '@/lib/safeFetch';

type LatestResponse = { ok: boolean; session: BridgeSession | null; error?: string; message?: string };


export default function LiveA2AAgentPage() {
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/agent-bridge/sessions/latest', { cache: 'no-store' });
        const data = await safeJson<LatestResponse>(res);
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
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-5 text-[#EAE4D8] selection:bg-[#C5A67C]/20 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%),radial-gradient(circle_at_82%_8%,rgba(255,255,255,0.055),transparent_26%)]" />
      <div className="relative mx-auto flex max-w-[1480px] flex-col gap-5 pt-8 pb-12 sm:pt-12">
        <header className="overflow-hidden rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90">
          <div className="flex flex-col gap-4 border-b border-white/10 px-5 py-5 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">ARCLAYER · EXTERNAL AGENT RUNTIME</div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5] sm:text-4xl">A2A AGENT BRIDGE</h1>
              <p className="mt-2 max-w-4xl text-sm text-[#EAE4D8]/70">External agents run anywhere. ArcLayer handles x402 access, bridge events, receipts, payload hashes, and proof history on Arc.</p>
            </div>
          </div>
          <div className="grid gap-px bg-white/10 md:grid-cols-4">
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Events</div><div className="font-mono text-lg text-[#C5A67C]">{session?.totals?.events ?? session?.events.length ?? 0}</div></div>
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Receipts</div><div className="font-mono text-lg text-emerald-300">{session?.totals?.receipts ?? session?.receipts.length ?? 0}</div></div>
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Roles</div><div className="font-mono text-lg text-[#D7C7AA]">{session?.totals?.roles ?? Object.keys(session?.roles ?? {}).length}</div></div>
            <div className="bg-black/25 px-4 py-3"><div className="font-mono text-[10px] uppercase text-[#EAE4D8]/45">Bridge</div><div className="font-mono text-lg text-[#C5A67C]">{error ? 'Degraded' : 'Live'}</div></div>
          </div>
        </header>
        <section className="rounded-sm border border-white/10 bg-black/25 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Agent Categories</div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {AGENT_CATEGORIES.map((category) => (
              <Link key={category.key} href={`/live-a2a-agent/${category.key}`} className="rounded-sm border border-white/10 bg-white/[0.03] p-3 transition hover:border-[#C5A67C]/35 hover:bg-[#C5A67C]/[0.04]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-sm font-bold uppercase tracking-[0.12em] text-[#F5F0E5]">{category.label}</div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#EAE4D8]/55">{category.tagline}</p>
                  </div>
                  <span className="rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] text-emerald-300">{category.status}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
