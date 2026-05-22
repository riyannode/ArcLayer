'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AGENT_CATEGORIES } from '../categories';
import type { ExternalJob } from '@/components/agent-bridge/ExternalJobsPanel';

function short(value?: string | null) { return !value ? '—' : value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value; }

export default function A2AJobsPage() {
  const [jobs, setJobs] = useState<ExternalJob[]>([]);
  const [category, setCategory] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/a2a/jobs?status=open', { cache: 'no-store' });
        const data = await res.json().catch(() => ({ jobs: [] }));
        if (!res.ok || data?.ok === false) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
        if (alive) { setJobs(Array.isArray(data.jobs) ? data.jobs : []); setError(null); }
      } catch (err) { if (alive) setError(err instanceof Error ? err.message : 'jobs_fetch_failed'); }
    }
    load();
    const id = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const filtered = useMemo(() => category === 'all' ? jobs : jobs.filter((job) => job.category === category), [jobs, category]);
  const groups = useMemo(() => {
    const map = new Map<string, ExternalJob[]>();
    filtered.forEach((job) => { const key = job.category || 'generic'; map.set(key, [...(map.get(key) ?? []), job]); });
    return [...map.entries()];
  }, [filtered]);

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-10 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1300px] space-y-5">
        <header className="rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">← A2A Agent Bridge</Link>
          <h1 className="mt-4 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5]">A2A Jobs</h1>
          <p className="mt-2 text-sm text-[#EAE4D8]/65">Choose a live external agent job.</p>
        </header>

        <section className="flex gap-2 overflow-x-auto rounded-sm border border-white/10 bg-black/25 p-3">
          <button onClick={() => setCategory('all')} className={`shrink-0 rounded-sm border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] ${category === 'all' ? 'border-[#C5A67C]/50 text-[#C5A67C]' : 'border-white/10 text-[#EAE4D8]/55'}`}>All</button>
          {AGENT_CATEGORIES.map((item) => <button key={item.key} onClick={() => setCategory(item.key)} className={`shrink-0 rounded-sm border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] ${category === item.key ? 'border-[#C5A67C]/50 text-[#C5A67C]' : 'border-white/10 text-[#EAE4D8]/55'}`}>{item.label}</button>)}
        </section>

        {error ? <div className="rounded-sm border border-red-400/25 bg-red-950/20 p-4 text-sm text-red-200">{error}</div> : null}

        <section className="space-y-4">
          {groups.length === 0 ? <div className="rounded-sm border border-dashed border-white/10 p-4 text-sm text-[#EAE4D8]/55">No jobs for selected category.</div> : groups.map(([key, items]) => (
            <div key={key} className="rounded-sm border border-white/10 bg-black/25 p-4">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">{key}</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((job) => <Link key={job.id} href={`/live-a2a-agent/jobs/${encodeURIComponent(job.id)}?category=${encodeURIComponent(job.category || key)}`} className="rounded-sm border border-white/10 bg-white/[0.03] p-3 transition hover:border-[#C5A67C]/35 hover:bg-[#C5A67C]/[0.04]">
                  <div className="flex items-start justify-between gap-2"><h3 className="line-clamp-2 font-mono text-sm font-bold uppercase tracking-[0.12em] text-[#F5F0E5]">{job.title}</h3><span className="rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] uppercase text-emerald-300">{job.status}</span></div>
                  <div className="mt-3 grid gap-2 text-xs text-[#EAE4D8]/60"><div>category: <span className="font-mono text-[#C5A67C]">{job.category || key}</span></div><div>role: <span className="font-mono text-[#C5A67C]">{job.roleId || 'any'}</span></div><div>budget: <span className="font-mono text-[#C5A67C]">{job.budget || '0.00'}</span></div><div>agent: <span className="font-mono text-[#C5A67C]">{short(job.agentId || job.claimedBy)}</span></div></div>
                </Link>)}
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
