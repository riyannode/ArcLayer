'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { ActiveDecisionDetail, buildPredictionMarketDecisionNodes, PredictionMarketDecisionBoard, type BridgeSession, type DecisionNode } from '@/components/agent-bridge';
import { BtcCandlestickPanel, PolymarketBtc15mPanel, PolymarketOrderbookPanel } from '@/components/market/PolymarketPanels';

type A2AJob = { id: string; title?: string; description?: string; category?: string; roleId?: string; budget?: string; status?: string; requester?: string; agentId?: string; claimedBy?: string; createdAt?: string; updatedAt?: string };
type LatestResponse = { ok: boolean; session: BridgeSession | null; error?: string; message?: string };
type PageProps = { params: Promise<{ id: string }> };

function short(value?: string | null) { return !value ? '—' : value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value; }
function Row({ label, value }: { label: string; value?: string | null }) { return <div>{label}: <span className="font-mono text-[#C5A67C]">{value || '—'}</span></div>; }

export default function LiveA2AJobDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const [job, setJob] = useState<A2AJob | null>(null);
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [selected, setSelected] = useState<DecisionNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [jobsRes, sessionRes] = await Promise.all([fetch('/api/a2a/jobs', { cache: 'no-store' }), fetch('/api/agent-bridge/sessions/latest', { cache: 'no-store' })]);
        const jobsData = await jobsRes.json().catch(() => ({ jobs: [] }));
        if (!jobsRes.ok || jobsData?.ok === false) throw new Error(jobsData?.message || jobsData?.error || `HTTP ${jobsRes.status}`);
        const found = (Array.isArray(jobsData.jobs) ? jobsData.jobs as A2AJob[] : []).find((item) => item.id === id) || null;
        const sessionData = (await sessionRes.json().catch(() => ({ session: null }))) as LatestResponse;
        if (!alive) return;
        setJob(found); setSession(sessionData.session ?? null); setError(found ? null : 'job_not_found');
      } catch (err) { if (alive) setError(err instanceof Error ? err.message : 'job_fetch_failed'); }
    }
    load();
    const timer = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, [id]);

  const defaultNode = useMemo(() => buildPredictionMarketDecisionNodes(session)[2] ?? null, [session]);
  const activeNode = selected ?? defaultNode;
  const isPrediction = job?.category === 'prediction-market-bots';

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-10 text-[#EAE4D8] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1480px] space-y-5">
        <header className="rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90 p-5">
          <Link href="/live-a2a-agent/jobs" className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">← A2A Jobs</Link>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Focused Job Detail</div><h1 className="mt-2 text-2xl font-black uppercase tracking-[0.14em] text-[#F5F0E5]">{job?.title || 'Loading job…'}</h1></div>
            <span className="rounded-sm border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 font-mono text-[9px] uppercase text-emerald-300">{job?.status || '—'}</span>
          </div>
        </header>
        {error ? <div className="rounded-sm border border-red-400/25 bg-red-950/20 p-3 text-sm text-red-200">{error}</div> : null}
        {job ? <section className="grid gap-2 rounded-sm border border-white/10 bg-white/[0.03] p-4 text-xs text-[#EAE4D8]/60 sm:grid-cols-2 lg:grid-cols-4"><Row label="category" value={job.category || 'generic'} /><Row label="role" value={job.roleId || 'any'} /><Row label="budget" value={job.budget || '0.00'} /><Row label="status" value={job.status} /><Row label="requester" value={short(job.requester)} /><Row label="assigned agent" value={short(job.agentId || job.claimedBy)} /><Row label="created" value={job.createdAt ? new Date(job.createdAt).toLocaleString() : undefined} /><Row label="updated" value={job.updatedAt ? new Date(job.updatedAt).toLocaleString() : undefined} /></section> : null}
        {isPrediction ? <><section className="grid gap-3 lg:grid-cols-3"><PolymarketBtc15mPanel /><PolymarketOrderbookPanel /><BtcCandlestickPanel /></section><PredictionMarketDecisionBoard session={session} onSelectNode={setSelected} /><ActiveDecisionDetail node={activeNode} /></> : <section className="rounded-sm border border-white/10 bg-black/25 p-4"><div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#C5A67C]">Job Workspace</div><p className="mt-2 text-sm text-[#EAE4D8]/65">Clean external-agent job view. Matching agents and latest bridge state appear when tagged by runtime.</p><div className="mt-4 grid gap-2 text-xs text-[#EAE4D8]/55 sm:grid-cols-3"><div>events: <span className="font-mono text-[#C5A67C]">{session?.events.filter((event) => event.job_id === id).length ?? 0}</span></div><div>receipts: <span className="font-mono text-[#C5A67C]">{session?.receipts.length ?? 0}</span></div><div>session: <span className="font-mono text-[#C5A67C]">{short(session?.sessionId)}</span></div></div></section>}
      </div>
    </main>
  );
}
