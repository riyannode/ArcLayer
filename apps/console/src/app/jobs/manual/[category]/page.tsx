'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { displayAgentLabel, formatSkillLabel, parseAgentSkill, shortAgentId } from '@/lib/agentName';
import { formatUSDC, shortenAddress } from '@/lib/contracts';
import { fetchIndexerJson, type IndexedAgent, type IndexedJob } from '@/lib/indexer';
import {
  categoryFromSlug,
  inferAgentCategory,
  getManualJobDisplay,
  JOB_TEMPLATES,
  MANUAL_CATEGORIES,
  slugFromCategory,
  type ManualCategory,
} from '@/lib/manualJobs';

const JOB_STATUS = ['Created', 'Budgeted', 'Funded', 'Submitted', 'Evaluated', 'Settled', 'Cancelled'] as const;
const JOB_TONE: Record<number, string> = { 0: '', 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'success', 6: 'error' };

export default function ManualJobCategoryPage() {
  const params = useParams<{ category: string }>();
  const category = categoryFromSlug(params.category ?? '') ?? 'Other';
  const categoryMeta = MANUAL_CATEGORIES.find((c) => c.key === category) ?? MANUAL_CATEGORIES[MANUAL_CATEGORIES.length - 1];

  const [jobs, setJobs] = useState<IndexedJob[]>([]);
  const [agents, setAgents] = useState<IndexedAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        const [nextJobs, nextAgents] = await Promise.all([
          fetchIndexerJson<IndexedJob[]>('/jobs'),
          fetchIndexerJson<IndexedAgent[]>('/agents'),
        ]);
        if (!cancelled) {
          setJobs(nextJobs);
          setAgents(nextAgents);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load manual marketplace.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.agentId, agent])), [agents]);

  const matchingJobs = useMemo(() => {
    return jobs
      .map((job) => ({ job, agent: agentById.get(job.agentId), display: getManualJobDisplay(job, agentById.get(job.agentId) ?? null) }))
      .filter((row) => row.display.category === category)
      .sort((a, b) => Number(BigInt(b.job.id) - BigInt(a.job.id)));
  }, [jobs, agentById, category]);

  const matchingAgents = useMemo(() => {
    return agents.filter((agent) => inferAgentCategory(agent) === category).slice(0, 8);
  }, [agents, category]);

  const templates = JOB_TEMPLATES.filter((template) => template.category === category);
  const fallbackTemplate = templates[0] ?? JOB_TEMPLATES[0];

  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link href="/jobs/manual#categories" className="font-mono text-[10px] text-[rgba(234,228,216,0.78)] hover:text-[#C5A67C]">
            ← Back to manual marketplace
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link href={`/jobs/manual?category=${encodeURIComponent(category)}#job-board`} className="btn-bordered">FILTER BOARD</Link>
            <Link href={`/jobs/manual?category=${encodeURIComponent(category)}#create-job`} className="btn-primary">CREATE JOB</Link>
          </div>
        </div>

        <header className="mb-6 overflow-hidden rounded-sm border border-[#C5A67C]/15 bg-[#0A0A0A]/90">
          <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.34em] text-[#C5A67C]">MANUAL MARKETPLACE · CATEGORY</div>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.16em] text-[#F5F0E5] sm:text-4xl">{categoryMeta.key}</h1>
              <p className="mt-2 max-w-2xl text-sm text-[#EAE4D8]/90 invisible">{categoryMeta.copy}</p>
            </div>
            <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
              <span className="chip-status pending">{matchingJobs.length} jobs</span>
              <span className="chip-status">{matchingAgents.length} agents</span>
              <span className="chip-status success">pure escrow</span>
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-sm border border-red-400/25 bg-red-400/5 p-4 font-mono text-[11px] text-red-200">{error}</div>
        )}

        <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">MATCHING AGENTS</div>
            <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Agents</h2>
            <p className="mt-1 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)]">Pick an agent, assign a task, lock USDC.</p>

            <div className="mt-4 space-y-3">
              {isLoading && <div className="font-mono text-[11px] text-[#C5A67C]">Loading agents…</div>}
              {!isLoading && matchingAgents.length === 0 && (
                <div className="rounded-sm border border-white/10 bg-black/25 p-4 font-mono text-[11px] text-[rgba(234,228,216,0.75)]">
                  No focused agents yet. Use any registered manual agent.
                </div>
              )}
              {matchingAgents.map((agent) => {
                const label = displayAgentLabel({ agentId: agent.agentId, metadataURI: agent.metadataURI });
                const skill = formatSkillLabel(parseAgentSkill(agent.metadataURI));
                return (
                  <div key={agent.agentId} className="rounded-sm border border-white/[0.07] bg-black/25 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-[12px] text-[#EAE4D8]">{label}</div>
                        <div className="mt-1 font-mono text-[10px] text-[rgba(234,228,216,0.65)]">{skill ?? 'Manual agent'} · {shortAgentId(agent.agentId)}</div>
                      </div>
                      <span className="chip-status pending">{agent.jobs?.length ?? 0} jobs</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={`/agent/${agent.agentId}`} className="btn-bordered px-2.5 py-1.5 text-[9px]">PROFILE</Link>
                      <Link href={`/jobs/manual?agent=${encodeURIComponent(agent.agentId)}&category=${encodeURIComponent(category)}#create-job`} className="btn-primary px-2.5 py-1.5 text-[9px]">USE AGENT</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">CATEGORY JOB BOARD</div>
            <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Jobs</h2>
            <p className="mt-1 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)]">Old jobs are inferred safely. No migration needed.</p>

            <div className="mt-4 space-y-3">
              {isLoading && <div className="font-mono text-[11px] text-[#C5A67C]">Loading jobs…</div>}
              {!isLoading && matchingJobs.length === 0 && (
                <div className="rounded-sm border border-white/10 bg-black/25 p-4 font-mono text-[11px] text-[rgba(234,228,216,0.75)]">
                  No jobs in this category yet.
                </div>
              )}
              {matchingJobs.slice(0, 12).map(({ job, agent, display }) => {
                const agentLabel = agent ? displayAgentLabel({ agentId: agent.agentId, metadataURI: agent.metadataURI }) : shortAgentId(job.agentId);
                return (
                  <div key={job.id} className="rounded-sm border border-white/[0.07] bg-black/25 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="mb-1 flex flex-wrap gap-2">
                          <span className="chip-status pending">{display.category}</span>
                          {!display.isStructured && <span className="chip-status">Legacy</span>}
                          <span className={`chip-status ${JOB_TONE[job.status] ?? ''}`}>{JOB_STATUS[job.status] ?? 'Unknown'}</span>
                        </div>
                        <Link href={`/job/${job.id}`} className="font-mono text-[12px] text-[#EAE4D8] hover:text-[#C5A67C]">{display.title}</Link>
                        <div className="mt-1 font-mono text-[10px] text-[rgba(234,228,216,0.72)]">Job #{job.id} · {agentLabel}</div>
                      </div>
                      <div className="text-right font-mono text-[10px] text-[rgba(234,228,216,0.72)]">
                        <div className="text-[#C5A67C]">{formatUSDC(BigInt(job.budget))} USDC</div>
                        <div>funded {formatUSDC(BigInt(job.fundedAmount))}</div>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.78)] invisible">{display.description}</p>
                    <div className="mt-2 grid gap-1 font-mono text-[9.5px] text-[rgba(234,228,216,0.62)] sm:grid-cols-2">
                      <span>Worker: {shortenAddress(job.worker)}</span>
                      <span>Client: {shortenAddress(job.client || job.evaluator)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={`/job/${job.id}`} className="btn-primary px-2.5 py-1.5 text-[9px]">OPEN JOB</Link>
                      <Link href={`/jobs/manual?agent=${encodeURIComponent(job.agentId)}&category=${encodeURIComponent(category)}#create-job`} className="btn-bordered px-2.5 py-1.5 text-[9px]">USE AGENT</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <section className="aureo-panel mt-6 p-4 md:p-6">
          <div className="aureo-mono-label mb-2">TASK TEMPLATES</div>
          <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Start fast</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {(templates.length ? templates : [fallbackTemplate]).map((template) => (
              <Link
                key={template.name}
                href={`/jobs/manual?category=${encodeURIComponent(template.category)}&template=${encodeURIComponent(template.name)}#create-job`}
                className="rounded-sm border border-white/[0.07] bg-black/25 p-4 transition hover:border-[#C5A67C]/35 hover:bg-white/[0.035]"
              >
                <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#EAE4D8]">{template.title}</div>
                <p className="mt-2 line-clamp-2 font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.78)] invisible">{template.jobSpec}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  <span className="chip-status pending">{template.duration}</span>
                  <span className="chip-status">{template.difficulty}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <div className="mt-6 overflow-x-auto border-y border-white/10 py-2">
          <nav className="flex min-w-max gap-2" aria-label="Manual categories">
            {MANUAL_CATEGORIES.map((cat) => (
              <Link key={cat.key} href={`/jobs/manual/${slugFromCategory(cat.key)}`} className={`btn-bordered px-3 py-2 text-[9.5px] ${cat.key === category ? 'border-[#C5A67C] text-[#EAE4D8]' : ''}`}>
                {cat.key}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
