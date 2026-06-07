'use client';

import { useEffect, useState } from 'react';

export type ExternalJob = {
  id: string;
  title: string;
  category?: string;
  roleId?: string;
  budget?: string;
  status: string;
  agentId?: string;
  claimedBy?: string;
};

function short(value?: string | null) {
  if (!value) return '—';
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function ExternalJobsPanel({ categoryKey, title = 'Available Jobs' }: { categoryKey?: string; title?: string }) {
  const [jobs, setJobs] = useState<ExternalJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const qs = new URLSearchParams({ status: 'open' });
        if (categoryKey) qs.set('category', categoryKey);
        const res = await fetch(`/api/a2a/jobs?${qs.toString()}`);
        const data = await res.json().catch(() => ({ jobs: [] }));
        if (!res.ok || data?.ok === false) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
        if (!cancelled) setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'jobs_fetch_failed');
          setJobs([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    const loadVisible = () => {
      if (document.hidden) return;
      void load();
    };
    void load();
    const id = setInterval(loadVisible, 45_000);
    const onVisibility = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [categoryKey]);

  return (
    <section className="rounded-sm border border-white/10 bg-black/25 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">{title}</div>
        </div>
        <a href="/api/a2a/jobs?status=open" className="rounded-sm border border-white/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/60 hover:border-[#C5A67C]/35 hover:text-[#C5A67C]">
          API
        </a>
      </div>

      {error ? (
        <div className="rounded-sm border border-red-400/25 bg-red-950/20 p-4 text-sm text-red-200">Jobs fetch failed: {error}</div>
      ) : loading ? (
        <div className="rounded-sm border border-white/10 p-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[#EAE4D8]/45">Loading open jobs…</div>
      ) : jobs.length === 0 ? (
        <div className="rounded-sm border border-dashed border-white/10 p-4 text-sm text-[#EAE4D8]/55">No open jobs for this scope yet.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="line-clamp-2 font-mono text-sm font-bold uppercase tracking-[0.12em] text-[#F5F0E5]">{job.title}</h3>
                <span className="rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] uppercase text-emerald-300">{job.status}</span>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-[#EAE4D8]/60">
                <div>category: <span className="font-mono text-[#C5A67C]">{job.category || categoryKey || 'generic'}</span></div>
                <div>roleId: <span className="font-mono text-[#C5A67C]">{job.roleId || 'any'}</span></div>
                <div>budget: <span className="font-mono text-[#C5A67C]">{job.budget || '0.00'}</span></div>
                <div>agent: <span className="font-mono text-[#C5A67C]">{short(job.agentId || job.claimedBy)}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
