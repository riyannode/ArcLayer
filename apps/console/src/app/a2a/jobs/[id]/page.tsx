'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { eventType, roleLabel, shortHash, type BridgeEvent, type BridgeSession } from '@/components/agent-bridge/types';

type A2AJob = {
  id: string;
  title: string;
  description?: string;
  category?: string;
  roleId?: string;
  budget?: string;
  status: string;
  agentId?: string;
  claimedBy?: string;
  input?: unknown;
  output?: unknown;
  proof?: unknown;
};

type JobsResponse = { ok?: boolean; jobs?: A2AJob[]; job?: A2AJob; error?: string; message?: string };
type LatestResponse = { ok?: boolean; session?: BridgeSession | null; error?: string; message?: string };
type PageProps = { params: Promise<{ id: string }> };

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  if (value == null) return null;
  return (
    <section className="rounded-sm border border-white/10 bg-black/25 p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">{title}</div>
      <pre className="max-h-[360px] overflow-auto rounded-sm border border-white/10 bg-[#050505] p-3 text-xs leading-5 text-[#EAE4D8]/70">{JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}

export default function A2AJobDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const jobId = decodeURIComponent(id);
  const [job, setJob] = useState<A2AJob | null>(null);
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [jobsRes, sessionRes] = await Promise.all([
          fetch('/api/a2a/jobs', { cache: 'no-store' }),
          fetch('/api/agent-bridge/sessions/latest', { cache: 'no-store' }),
        ]);
        const jobsData = (await jobsRes.json().catch(() => ({}))) as JobsResponse;
        const sessionData = (await sessionRes.json().catch(() => ({}))) as LatestResponse;
        if (!alive) return;
        if (!jobsRes.ok || jobsData.ok === false) throw new Error(jobsData.message || jobsData.error || `jobs ${jobsRes.status}`);
        setJob((jobsData.jobs || []).find((item) => item.id === jobId) || jobsData.job || null);
        setSession(sessionData.ok === false ? null : sessionData.session || null);
        setError(null);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'job_fetch_failed');
      }
    }
    load();
    return () => { alive = false; };
  }, [jobId]);

  const linkedEvents = useMemo<BridgeEvent[]>(() => (session?.events || []).filter((event) => event.job_id === jobId || event.payload?.jobId === jobId || event.metadata?.jobId === jobId), [session, jobId]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] px-4 py-8 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(197,166,124,0.14),transparent_30%)]" />
      <div className="relative mx-auto flex max-w-[1200px] flex-col gap-5">
        <header className="rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C] hover:text-[#F5F0E5]">← A2A Agent Bridge</Link>
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">A2A Job Detail</div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.14em] text-[#F5F0E5]">{job?.title || shortHash(jobId)}</h1>
            </div>
            <span className="w-fit rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] uppercase text-emerald-300">{job?.status || 'loading'}</span>
          </div>
        </header>

        {error ? <div className="rounded-sm border border-red-400/25 bg-red-950/20 p-4 text-sm text-red-200">{error}</div> : null}
        {!job && !error ? <div className="rounded-sm border border-white/10 p-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[#EAE4D8]/45">Loading job…</div> : null}
        {!job && !error ? null : job ? (
          <>
            <section className="grid gap-3 rounded-sm border border-white/10 bg-black/25 p-4 md:grid-cols-3">
              <Field label="category" value={job.category || 'generic'} />
              <Field label="roleId" value={job.roleId || 'any'} />
              <Field label="budget" value={job.budget || '0.00'} />
              <Field label="agentId" value={job.agentId || '—'} />
              <Field label="claimedBy" value={job.claimedBy || '—'} />
              <Field label="jobId" value={job.id} />
            </section>
            {job.description ? <section className="rounded-sm border border-white/10 bg-black/25 p-4"><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Explanation</div><p className="mt-2 text-sm leading-6 text-[#EAE4D8]/70">{job.description}</p></section> : null}
            <section className="rounded-sm border border-white/10 bg-black/25 p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Claim / Submit API hint</div>
              <div className="mt-3 grid gap-2 font-mono text-[10px] text-[#EAE4D8]/65">
                <code className="rounded-sm border border-white/10 bg-[#050505] p-3">POST /api/a2a/jobs/{job.id}/claim</code>
                <code className="rounded-sm border border-white/10 bg-[#050505] p-3">POST /api/a2a/jobs/{job.id}/submit</code>
              </div>
            </section>
            <JsonBlock title="Input" value={job.input} />
            <JsonBlock title="Output" value={job.output} />
            <JsonBlock title="Proof" value={job.proof} />
            <section className="rounded-sm border border-white/10 bg-black/25 p-4">
              <div className="mb-3 flex items-center justify-between"><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Linked Bridge Events</div><span className="font-mono text-[10px] text-[#EAE4D8]/45">{linkedEvents.length}</span></div>
              {linkedEvents.length === 0 ? <div className="rounded-sm border border-dashed border-white/10 p-4 text-sm text-[#EAE4D8]/55">No linked bridge events yet.</div> : <div className="grid gap-2 md:grid-cols-2">{linkedEvents.map((event) => <article key={event.id} className="rounded-sm border border-white/10 bg-white/[0.03] p-3"><div className="font-mono text-[11px] text-[#F5F0E5]">{roleLabel(event.role)} · <span className="text-[#C5A67C]">{eventType(event)}</span></div><div className="mt-2 text-xs text-[#EAE4D8]/55">hash: <span className="font-mono text-[#C5A67C]">{shortHash(event.payload_hash)}</span></div></article>)}</div>}
            </section>
          </>
        ) : <div className="rounded-sm border border-dashed border-white/10 p-4 text-sm text-[#EAE4D8]/55">Job not found.</div>}
      </div>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="rounded-sm border border-white/10 bg-white/[0.03] p-3"><div className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#EAE4D8]/40">{label}</div><div className="mt-1 break-all font-mono text-sm text-[#C5A67C]">{value}</div></div>;
}
