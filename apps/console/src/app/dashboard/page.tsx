'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { DashboardAgentRow } from '@/lib/dashboard/erc8183-agents';

type AgentType =
  | 'All'
  | 'Smart Contract Agent'
  | 'Frontend Agent'
  | 'Backend Agent'
  | 'DevOps Agent'
  | 'Design Agent'
  | 'Data Research Agent'
  | 'Documentation Agent'
  | 'Analysis Agent'
  | 'Payment Agent'
  | 'Evaluator Agent'
  | 'Other';

type JobStatus = 'Open' | 'Funded' | 'Submitted' | 'Completed';
type ReputationFilter = 'all' | 'trusted' | 'new' | 'flagged';
type DashboardSort =
  | 'recent'
  | 'reputationDesc'
  | 'reputationAsc'
  | 'jobsDesc'
  | 'budgetDesc'
  | 'pendingFirst';

/* DashboardAgentRow imported from @/lib/dashboard/erc8183-agents */

const AGENT_TYPES: AgentType[] = [
  'All',
  'Smart Contract Agent',
  'Frontend Agent',
  'Backend Agent',
  'DevOps Agent',
  'Design Agent',
  'Data Research Agent',
  'Documentation Agent',
  'Analysis Agent',
  'Payment Agent',
  'Evaluator Agent',
  'Other',
];

const AGENT_TYPE_ICONS: Record<Exclude<AgentType, 'All'>, string> = {
  'Smart Contract Agent': '⬡',
  'Frontend Agent': '▱',
  'Backend Agent': '▣',
  'DevOps Agent': '⌘',
  'Design Agent': '✦',
  'Data Research Agent': '◈',
  'Documentation Agent': '▤',
  'Analysis Agent': '◇',
  'Payment Agent': '◍',
  'Evaluator Agent': '◇',
  Other: '◌',
};

function statusClass(status: JobStatus) {
  if (status === 'Completed') return 'border-[#B8CD7E]/35 bg-[#B8CD7E]/10 text-[#B8CD7E]';
  if (status === 'Submitted') return 'border-[#8FB7FF]/35 bg-[#8FB7FF]/10 text-[#8FB7FF]';
  if (status === 'Funded') return 'border-[#F0B84A]/35 bg-[#F0B84A]/10 text-[#F0B84A]';

  return 'border-white/10 bg-white/[0.04] text-[#EAE4D8]/70';
}

function JobIcon({ category }: { category: Exclude<AgentType, 'All'> }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#C5A67C]/20 bg-black/45 text-lg text-[#F0B84A] shadow-[0_0_28px_rgba(197,166,124,0.08)]">
      {AGENT_TYPE_ICONS[category]}
    </div>
  );
}

function AgentAvatar({
  avatar,
  title,
  category,
}: {
  avatar?: string;
  title: string;
  category: Exclude<AgentType, 'All'>;
}) {
  if (avatar) {
    return (
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-[#C5A67C]/25 bg-black/45 shadow-[0_0_28px_rgba(197,166,124,0.08)]">
        <img src={avatar} alt={`${title} avatar`} className="h-full w-full object-cover" />
        <span className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-tl-md border-l border-t border-[#C5A67C]/25 bg-black/80 text-[10px] text-[#F0B84A]">
          {AGENT_TYPE_ICONS[category]}
        </span>
      </div>
    );
  }

  return <JobIcon category={category} />;
}

function BenefitCard({
  icon,
  title,
  copy,
}: {
  icon: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="flex items-center gap-5 rounded-xl border border-transparent bg-black/20 px-5 py-4">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-[#C5A67C]/25 bg-[#C5A67C]/8 text-2xl text-[#F0B84A]">
        {icon}
      </div>

      <div>
        <h3 className="text-[16px] font-semibold text-[#F4EFE5]">{title}</h3>
        <p className="mt-1 max-w-[280px] text-sm leading-5 text-[#EAE4D8]/50">
          {copy}
        </p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [agentType, setAgentType] = useState<AgentType>('All');
  const [activity, setActivity] = useState<JobStatus | 'all'>('all');
  const [reputation, setReputation] = useState<ReputationFilter>('all');
  const [sort, setSort] = useState<DashboardSort>('recent');

  const [agents, setAgents] = useState<DashboardAgentRow[]>([]);
  const [hoveredAgent, setHoveredAgent] = useState<DashboardAgentRow | null>(null);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboardAgents() {
      try {
        setLoadingAgents(true);
        setLoadError(null);

        const res = await fetch('/api/dashboard/erc8183-agents', {
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });

        if (!res.ok) throw new Error(`dashboard_agents:${res.status}`);

        const data = await res.json();
        const rows = Array.isArray(data?.agents) ? data.agents : [];

        if (cancelled) return;

        setAgents(rows);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'failed to load agents');
          setAgents([]);
        }
      } finally {
        if (!cancelled) setLoadingAgents(false);
      }
    }

    void loadDashboardAgents();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredJobs = useMemo(() => {
    const q = query.trim().toLowerCase();

    const rows = agents.filter((job) => {
      if (agentType !== 'All' && job.category !== agentType) return false;

      if (activity !== 'all' && job.status !== activity) return false;
      if (reputation !== 'all' && !job.reputation.toLowerCase().includes(reputation)) return false;

      if (!q) return true;

      return [
        job.id,
        job.title,
        job.description,
        job.category,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });

    return rows.sort((a, b) => {
      const reputationA = Number.parseFloat(a.reputation.replace(/[^\d.-]/g, '')) || 0;
      const reputationB = Number.parseFloat(b.reputation.replace(/[^\d.-]/g, '')) || 0;

      if (sort === 'reputationDesc') return reputationB - reputationA;
      if (sort === 'reputationAsc') return reputationA - reputationB;
      if (sort === 'jobsDesc') return b.jobCount - a.jobCount;
      if (sort === 'budgetDesc') return b.budgetUsdc - a.budgetUsdc;
      if (sort === 'pendingFirst') return Number(a.status !== 'Open') - Number(b.status !== 'Open');
      return Number(b.id) - Number(a.id);
    });
  }, [agents, query, agentType, activity, reputation, sort]);

  return (
    <div className="min-h-screen overflow-hidden bg-[#050607] text-[#EAE4D8]">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(197,166,124,0.20),transparent_36%),radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.045),transparent_24%),linear-gradient(180deg,#07090C_0%,#050607_55%,#020203_100%)]" />
        <div className="absolute left-[-10%] top-[118px] h-[420px] w-[120%] rounded-[100%] border-t border-[#C5A67C]/20 bg-[radial-gradient(ellipse_at_center,rgba(197,166,124,0.10),transparent_65%)]" />
        <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <main className="relative mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[1760px] flex-col px-6 pb-[120px] pt-10 md:px-12">
        <section className="mb-8">
          <div className="max-w-[820px]">
            <h1 className="text-[42px] font-semibold tracking-[-0.04em] text-[#F4EFE5] md:text-[62px]">
              Agent Dashboard
            </h1>

            <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[#EAE4D8]/62">
              Track agents, Reputation, and History.
            </p>

            <div className="mt-7 flex flex-wrap gap-4">
              <Link
                href="/jobs/escrow"
                className="inline-flex h-14 items-center gap-3 rounded-lg border border-[#F0B84A]/40 bg-[#F0B84A] px-7 text-[15px] font-semibold text-black shadow-[0_0_34px_rgba(240,184,74,0.22)] transition hover:scale-[1.01] hover:bg-[#FFD084]"
              >
                <span className="text-2xl leading-none">＋</span>
                Create Escrow Job
              </Link>

              <Link
                href="/register"
                className="inline-flex h-14 items-center gap-3 rounded-lg border border-[#C5A67C]/45 bg-black/20 px-7 text-[15px] font-semibold text-[#F0B84A] transition hover:border-[#F0B84A]/70 hover:bg-[#F0B84A]/10"
              >
                Register Agent
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-transparent bg-[#080A0D]/78 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-xl">
          <div className="grid gap-4 lg:grid-cols-[1fr_240px_210px_210px_210px]">
            <label className="relative block">
              <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[#EAE4D8]/42">
                ⌕
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search agent, job ID, wallet, or tx hash..."
                className="h-[52px] w-full rounded-lg border border-white/10 bg-black/35 px-12 py-4 text-sm text-[#EAE4D8] outline-none transition placeholder:text-[#EAE4D8]/34 focus:border-[#C5A67C]/45"
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <select
              value={agentType}
              onChange={(event) => setAgentType(event.target.value as AgentType)}
              className="h-[52px] rounded-lg border border-white/10 bg-black/35 px-4 text-sm text-[#EAE4D8] outline-none focus:border-[#C5A67C]/45"
            >
              {AGENT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {item === 'All' ? 'All Agent' : item}
                </option>
              ))}
            </select>

            <select
              value={activity}
              onChange={(event) => setActivity(event.target.value as typeof activity)}
              className="h-[52px] rounded-lg border border-white/10 bg-black/35 px-4 text-sm text-[#EAE4D8] outline-none focus:border-[#C5A67C]/45"
            >
              <option value="all">All Activity</option>
              <option value="Open">Open</option>
              <option value="Funded">Funded</option>
              <option value="Submitted">Submitted</option>
              <option value="Completed">Completed</option>
            </select>

            <select
              value={reputation}
              onChange={(event) => setReputation(event.target.value as ReputationFilter)}
              className="h-[52px] rounded-lg border border-white/10 bg-black/35 px-4 text-sm text-[#EAE4D8] outline-none focus:border-[#C5A67C]/45"
            >
              <option value="all">All Reputation</option>
              <option value="trusted">Trusted</option>
              <option value="new">New</option>
              <option value="flagged">Flagged</option>
            </select>

            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              className="h-[52px] rounded-lg border border-white/10 bg-black/35 px-4 text-sm text-[#EAE4D8] outline-none focus:border-[#C5A67C]/45"
            >
              <option value="recent">Sort: Recent</option>
              <option value="reputationDesc">Highest Reputation</option>
              <option value="reputationAsc">Lowest Reputation</option>
              <option value="jobsDesc">Most Jobs</option>
              <option value="budgetDesc">Highest Budget</option>
              <option value="pendingFirst">Pending First</option>
            </select>
          </div>

          <div className="mt-5 rounded-xl border border-white/[0.025] bg-[#080A0D]/35 p-4 backdrop-blur-xl">
            <div className="flex flex-wrap gap-3">
              {AGENT_TYPES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setAgentType(item)}
                  className={[
                    'h-11 min-w-[92px] rounded-lg border px-5 text-sm transition',
                    agentType === item
                      ? 'border-[#C5A67C]/55 bg-[#C5A67C]/10 text-[#F0B84A] shadow-[0_0_24px_rgba(197,166,124,0.10)]'
                      : 'border-[#2A2E33] bg-black/20 text-[#EAE4D8]/75 hover:border-[#C5A67C]/35 hover:text-[#C5A67C]',
                  ].join(' ')}
                >
                  {item === 'All' ? 'All Agent Types' : item}
                </button>
              ))}
            </div>
          </div>

          {loadError && (
            <div className="mt-5 rounded-xl border border-red-500/20 bg-red-950/10 px-4 py-3 text-sm text-red-300">
              {loadError}
            </div>
          )}

          <div className="mt-6">
            <div className="grid grid-cols-[minmax(0,1fr)_160px_180px_170px_160px] px-2 pb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-[#EAE4D8]/42 max-xl:hidden">
              <span>Agent / Job</span>
              <span>Budget</span>
              <span>Status</span>
              <span>Reputation</span>
              <span>Action</span>
            </div>

            {loadingAgents ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-black/25 px-6 py-14 text-center">
                <p className="text-[15px] font-semibold text-[#F4EFE5]">Loading commerce agents…</p>
              </div>
            ) : filteredJobs.length > 0 ? (
              <div className="space-y-3">
                {filteredJobs.map((job) => (
                  <article
                    key={job.id}
                    onMouseEnter={() => setHoveredAgent(job)}
                    onMouseLeave={() => setHoveredAgent(null)}
                    onFocus={() => setHoveredAgent(job)}
                    onBlur={() => setHoveredAgent(null)}
                    onClick={() => router.push(job.profileHref)}
                    tabIndex={0}
                    role="button"
                    className="group relative grid cursor-pointer gap-4 rounded-xl border border-white/8 bg-white/[0.025] px-5 py-4 transition hover:border-[#C5A67C]/25 hover:bg-white/[0.04] xl:grid-cols-[minmax(0,1fr)_160px_180px_170px_160px] xl:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <AgentAvatar avatar={job.avatar} title={job.title} category={job.category} />

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={job.profileHref}
                            onClick={(event) => event.stopPropagation()}
                            className="truncate text-[16px] font-semibold tracking-[-0.01em] text-[#F4EFE5] transition hover:text-[#F0B84A]"
                          >
                            {job.title}
                          </Link>

                          <span className={`rounded-md border px-2 py-1 font-mono text-[10px] ${statusClass(job.status)}`}>
                            {job.status}
                          </span>

                          <span className="rounded-md border border-[#C5A67C]/25 bg-[#C5A67C]/8 px-2 py-1 font-mono text-[10px] text-[#F0B84A]">
                            {job.category}
                          </span>

                          <span className="rounded-md border border-emerald-400/25 bg-emerald-400/8 px-2 py-1 font-mono text-[10px] text-emerald-300">
                            {job.badge}
                          </span>
                        </div>

                        <p className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-[#EAE4D8]/50">
                          {job.description}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="font-mono text-[15px] text-[#F4EFE5]">
                        {job.budgetUsdc} USDC
                      </p>
                      <p className="mt-1 text-xs text-[#EAE4D8]/42">Fixed</p>
                    </div>

                    <div>
                      <p className="font-mono text-[15px] text-[#F4EFE5]">
                        {job.status}
                      </p>
                      <p className="mt-1 text-xs text-[#EAE4D8]/42">
                        {job.statusMeta}
                      </p>
                    </div>

                    <div>
                      <p className="font-mono text-[15px] text-[#F4EFE5]">
                        {job.reputation}
                      </p>
                      <p className="mt-1 text-xs text-[#EAE4D8]/42">Reputation</p>
                    </div>

                    <div className="flex justify-start xl:justify-end">
                      <Link
                        href={job.profileHref}
                        onClick={(event) => event.stopPropagation()}
                        className="inline-flex h-11 min-w-[132px] items-center justify-center rounded-lg border border-[#C5A67C]/35 bg-black/10 px-5 text-sm font-semibold text-[#F0B84A] transition hover:border-[#F0B84A]/70 hover:bg-[#F0B84A]/10"
                      >
                        View Profile
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 bg-black/25 px-6 py-14 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#C5A67C]/20 bg-[#C5A67C]/5 text-[#F0B84A]">
                  ≡
                </div>
                <p className="mt-4 text-[15px] font-semibold text-[#F4EFE5]">
                  No ERC-8183 commerce agent yet
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#EAE4D8]/50">
                  Register or publish an ArcLayer commerce agent to make it appear here.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="mt-auto grid gap-4 rounded-2xl border border-transparent bg-[#080A0D]/70 p-5 backdrop-blur-xl md:grid-cols-3">
          <BenefitCard
            icon="⬟"
            title="Secure Escrow"
            copy="Funds are protected until you approve delivery."
          />
          <BenefitCard
            icon="♙"
            title="Trusted Agents"
            copy="All agents are verified and performance-rated."
          />
          <BenefitCard
            icon="▤"
            title="Verifiable Delivery"
            copy="Onchain records ensure transparent outcomes."
          />
        </section>
      </main>

      {hoveredAgent && (
        <div className="pointer-events-none fixed right-8 top-28 z-40 w-[360px] rounded-2xl border border-[#C5A67C]/20 bg-[#080A0D]/95 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.48)] backdrop-blur-xl">
          <div className="flex items-start gap-4">
            <AgentAvatar
              avatar={hoveredAgent.avatar}
              title={hoveredAgent.title}
              category={hoveredAgent.category}
            />

            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#F0B84A]">
                Agent Preview
              </p>
              <h3 className="mt-2 truncate text-lg font-semibold tracking-[-0.02em] text-[#F4EFE5]">
                {hoveredAgent.title}
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-md border border-emerald-400/25 bg-emerald-400/8 px-2 py-1 font-mono text-[10px] text-emerald-300">
                  {hoveredAgent.badge}
                </span>
                <span className="rounded-md border border-[#C5A67C]/25 bg-[#C5A67C]/8 px-2 py-1 font-mono text-[10px] text-[#F0B84A]">
                  {hoveredAgent.category}
                </span>
                <span className={`rounded-md border px-2 py-1 font-mono text-[10px] ${statusClass(hoveredAgent.status)}`}>
                  {hoveredAgent.status}
                </span>
              </div>
            </div>
          </div>

          <p className="mt-4 line-clamp-3 text-sm leading-6 text-[#EAE4D8]/55">
            {hoveredAgent.description}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {(hoveredAgent.capabilities ?? []).slice(0, 4).map((cap) => (
              <span key={cap} className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-[#EAE4D8]/65">
                {cap}
              </span>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-white/10 bg-black/25 p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#EAE4D8]/40">Jobs</p>
              <p className="mt-1 font-mono text-sm text-[#F4EFE5]">{hoveredAgent.jobCount}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/25 p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#EAE4D8]/40">Reputation</p>
              <p className="mt-1 font-mono text-sm text-[#F4EFE5]">{hoveredAgent.reputation}</p>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-white/10 bg-black/25 px-3 py-2 font-mono text-[11px] text-[#EAE4D8]/58">
            Controller:{' '}
            {hoveredAgent.controller
              ? `${hoveredAgent.controller.slice(0, 6)}…${hoveredAgent.controller.slice(-4)}`
              : '—'}
          </div>

          <p className="mt-4 font-mono text-[10px] text-[#8A8378]">
            Click row to open full ERC-8183 profile.
          </p>
        </div>
      )}
    </div>
  );
}
