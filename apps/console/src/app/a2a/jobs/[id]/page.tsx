'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';

type A2AJob = {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  roleId?: string;
  budget?: string;
  status?: string;
  requester?: string;
  agentId?: string;
  claimedBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

type PageProps = { params: Promise<{ id: string }> };

function short(value?: string | null) {
  if (!value) return '—';
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return <div>{label}: <span className="font-mono text-[#C5A67C]">{value || '—'}</span></div>;
}

export default function A2AJobDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const [job, setJob] = useState<A2AJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/a2a/jobs', { cache: 'no-store' });
        const data = await res.json().catch(() => ({ jobs: [] }));
        if (!res.ok || data?.ok === false) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
        const jobs = Array.isArray(data.jobs) ? data.jobs as A2AJob[] : [];
        const found = jobs.find((item) => item.id === id) || null;
        if (!alive) return;
        setJob(found);
        if (!found) setError('job_not_found');
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'job_fetch_failed');
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, [id]);

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-12 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl rounded-sm border border-white/10 bg-black/30 p-5">
        <Link href="/live-a2a-agent" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C] hover:text-[#F5F0E5]">← A2A Agent Bridge</Link>
        <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">A2A Job Detail</div>
            <h1 className="mt-2 text-2xl font-black uppercase tracking-[0.14em] text-[#F5F0E5]">{job?.title || (loading ? 'Loading…' : 'Job unavailable')}</h1>
          </div>
          <span className="rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] uppercase text-emerald-300">{job?.status || '—'}</span>
        </div>

        {error ? <div className="mt-4 rounded-sm border border-red-400/25 bg-red-950/20 p-3 text-sm text-red-200">{error}</div> : null}

        {job ? (
          <div className="mt-5 grid gap-4">
            {job.description ? <p className="rounded-sm border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-[#EAE4D8]/65">{job.description}</p> : null}
            <div className="grid gap-2 rounded-sm border border-white/10 bg-white/[0.03] p-3 text-xs text-[#EAE4D8]/60 sm:grid-cols-2">
              <Row label="id" value={short(job.id)} />
              <Row label="category" value={job.category || 'generic'} />
              <Row label="roleId" value={job.roleId || 'any'} />
              <Row label="budget" value={job.budget || '0.00'} />
              <Row label="requester" value={short(job.requester)} />
              <Row label="agent" value={short(job.agentId || job.claimedBy)} />
              <Row label="created" value={job.createdAt ? new Date(job.createdAt).toLocaleString() : undefined} />
              <Row label="updated" value={job.updatedAt ? new Date(job.updatedAt).toLocaleString() : undefined} />
            </div>
            <a href={`/api/a2a/jobs?status=${encodeURIComponent(job.status || '')}`} className="inline-flex w-fit rounded-sm border border-[#C5A67C]/35 bg-[#C5A67C]/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C] hover:bg-[#C5A67C]/15">Open Jobs API →</a>
          </div>
        ) : null}
      </div>
    </main>
  );
}
