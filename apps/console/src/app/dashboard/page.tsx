'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type JobCategory =
  | 'All'
  | 'Smart Contract'
  | 'Frontend'
  | 'Backend'
  | 'DevOps'
  | 'Design'
  | 'Data Research'
  | 'Documentation'
  | 'Analysis'
  | 'Other';

type JobStatus = 'Open' | 'Funded' | 'Submitted' | 'Completed';

type DashboardJob = {
  id: string;
  title: string;
  description: string;
  category: Exclude<JobCategory, 'All'>;
  budgetUsdc: number;
  deadline: string;
  deadlineMeta: string;
  proposals: number;
  status: JobStatus;
};

const CATEGORIES: JobCategory[] = [
  'All',
  'Smart Contract',
  'Frontend',
  'Backend',
  'DevOps',
  'Design',
  'Data Research',
  'Documentation',
  'Analysis',
  'Other',
];

const CATEGORY_ICONS: Record<Exclude<JobCategory, 'All'>, string> = {
  'Smart Contract': '⬡',
  Frontend: '▱',
  Backend: '▣',
  DevOps: '⌘',
  Design: '✦',
  'Data Research': '◈',
  Documentation: '▤',
  Analysis: '◇',
  Other: '◌',
};

function statusClass(status: JobStatus) {
  if (status === 'Completed') return 'border-[#B8CD7E]/35 bg-[#B8CD7E]/10 text-[#B8CD7E]';
  if (status === 'Submitted') return 'border-[#8FB7FF]/35 bg-[#8FB7FF]/10 text-[#8FB7FF]';
  if (status === 'Funded') return 'border-[#F0B84A]/35 bg-[#F0B84A]/10 text-[#F0B84A]';

  return 'border-white/10 bg-white/[0.04] text-[#EAE4D8]/70';
}

function JobIcon({ category }: { category: Exclude<JobCategory, 'All'> }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#C5A67C]/20 bg-black/45 text-lg text-[#F0B84A] shadow-[0_0_28px_rgba(197,166,124,0.08)]">
      {CATEGORY_ICONS[category]}
    </div>
  );
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
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<JobCategory>('All');
  const [budget, setBudget] = useState<'all' | 'under100' | '100to250' | 'over250'>('all');
  const [deadline, setDeadline] = useState<'all' | 'soon' | 'week' | 'later'>('all');
  const [sort, setSort] = useState<'newest' | 'budgetDesc' | 'budgetAsc' | 'proposals'>('newest');

  // Backend nanti masuk di sini.
  // Jangan pakai mock data. Kalau backend belum di-wire, biarkan kosong.
  const jobs: DashboardJob[] = [];

  const filteredJobs = useMemo(() => {
    const q = query.trim().toLowerCase();

    const rows = jobs.filter((job) => {
      if (category !== 'All' && job.category !== category) return false;

      if (budget === 'under100' && job.budgetUsdc >= 100) return false;
      if (budget === '100to250' && (job.budgetUsdc < 100 || job.budgetUsdc > 250)) return false;
      if (budget === 'over250' && job.budgetUsdc <= 250) return false;

      if (deadline !== 'all') {
        if (deadline === 'soon' && !job.deadlineMeta.includes('1 day')) return false;
        if (deadline === 'week' && !job.deadlineMeta.includes('days')) return false;
        if (deadline === 'later' && job.deadlineMeta.includes('1 day')) return false;
      }

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
      if (sort === 'budgetDesc') return b.budgetUsdc - a.budgetUsdc;
      if (sort === 'budgetAsc') return a.budgetUsdc - b.budgetUsdc;
      if (sort === 'proposals') return b.proposals - a.proposals;

      return Number(b.id) - Number(a.id);
    });
  }, [jobs, query, category, budget, deadline, sort]);

  return (
    <div className="min-h-screen overflow-hidden bg-[#050607] text-[#EAE4D8]">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(197,166,124,0.20),transparent_36%),radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.045),transparent_24%),linear-gradient(180deg,#07090C_0%,#050607_55%,#020203_100%)]" />
        <div className="absolute left-[-10%] top-[118px] h-[420px] w-[120%] rounded-[100%] border-t border-[#C5A67C]/20 bg-[radial-gradient(ellipse_at_center,rgba(197,166,124,0.10),transparent_65%)]" />
        <div className="absolute inset-0 opacity-[0.10] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <main className="relative mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[1760px] flex-col px-6 pb-0 pt-10 md:px-12">
        <section className="mb-8">
          <div className="max-w-[820px]">
            <h1 className="text-[42px] font-semibold tracking-[-0.04em] text-[#F4EFE5] md:text-[62px]">
              Marketplace Dashboard
            </h1>

            <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[#EAE4D8]/62">
              Post jobs. Find trusted agents. Get work done onchain.
            </p>

            <div className="mt-7 flex flex-wrap gap-4">
              <Link
                href="/jobs/manual#create-job"
                className="inline-flex h-14 items-center gap-3 rounded-lg border border-[#F0B84A]/40 bg-[#F0B84A] px-7 text-[15px] font-semibold text-black shadow-[0_0_34px_rgba(240,184,74,0.22)] transition hover:scale-[1.01] hover:bg-[#FFD084]"
              >
                <span className="text-2xl leading-none">＋</span>
                Post a Manual Job
              </Link>

              <Link
                href="/register/manual"
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
                placeholder="Search jobs by title, skills, or keywords..."
                className="h-[52px] w-full rounded-lg border border-white/10 bg-black/35 px-12 py-4 text-sm text-[#EAE4D8] outline-none transition placeholder:text-[#EAE4D8]/34 focus:border-[#C5A67C]/45"
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as JobCategory)}
              className="h-[52px] rounded-lg border border-white/10 bg-black/35 px-4 text-sm text-[#EAE4D8] outline-none focus:border-[#C5A67C]/45"
            >
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item === 'All' ? 'All Categories' : item}
                </option>
              ))}
            </select>

            <select
              value={budget}
              onChange={(event) => setBudget(event.target.value as typeof budget)}
              className="h-[52px] rounded-lg border border-white/10 bg-black/35 px-4 text-sm text-[#EAE4D8] outline-none focus:border-[#C5A67C]/45"
            >
              <option value="all">All Budgets</option>
              <option value="under100">Under 100 USDC</option>
              <option value="100to250">100–250 USDC</option>
              <option value="over250">Over 250 USDC</option>
            </select>

            <select
              value={deadline}
              onChange={(event) => setDeadline(event.target.value as typeof deadline)}
              className="h-[52px] rounded-lg border border-white/10 bg-black/35 px-4 text-sm text-[#EAE4D8] outline-none focus:border-[#C5A67C]/45"
            >
              <option value="all">All Deadlines</option>
              <option value="soon">Due Soon</option>
              <option value="week">This Week</option>
              <option value="later">Later</option>
            </select>

            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              className="h-[52px] rounded-lg border border-white/10 bg-black/35 px-4 text-sm text-[#EAE4D8] outline-none focus:border-[#C5A67C]/45"
            >
              <option value="newest">Sort: Newest</option>
              <option value="budgetDesc">Highest Budget</option>
              <option value="budgetAsc">Lowest Budget</option>
              <option value="proposals">Most Proposals</option>
            </select>
          </div>

          <div className="mt-5 rounded-xl border border-white/[0.025] bg-[#080A0D]/35 p-4 backdrop-blur-xl">
            <div className="flex flex-wrap gap-3">
              {CATEGORIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  className={[
                    'h-11 min-w-[92px] rounded-lg border px-5 text-sm transition',
                    category === item
                      ? 'border-[#C5A67C]/55 bg-[#C5A67C]/10 text-[#F0B84A] shadow-[0_0_24px_rgba(197,166,124,0.10)]'
                      : 'border-[#2A2E33] bg-black/20 text-[#EAE4D8]/75 hover:border-[#C5A67C]/35 hover:text-[#C5A67C]',
                  ].join(' ')}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <div className="grid grid-cols-[minmax(0,1fr)_160px_180px_170px_160px] px-2 pb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-[#EAE4D8]/42 max-xl:hidden">
              <span>Job</span>
              <span>Budget</span>
              <span>Deadline</span>
              <span>Proposals</span>
              <span>Action</span>
            </div>

            {filteredJobs.length > 0 ? (
              <div className="space-y-3">
                {filteredJobs.map((job) => (
                  <article
                    key={job.id}
                    className="group grid gap-4 rounded-xl border border-white/8 bg-white/[0.025] px-5 py-4 transition hover:border-[#C5A67C]/25 hover:bg-white/[0.04] xl:grid-cols-[minmax(0,1fr)_160px_180px_170px_160px] xl:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <JobIcon category={job.category} />

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/job/${job.id}`}
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
                        {job.deadline}
                      </p>
                      <p className="mt-1 text-xs text-[#EAE4D8]/42">
                        {job.deadlineMeta}
                      </p>
                    </div>

                    <div>
                      <p className="font-mono text-[15px] text-[#F4EFE5]">
                        {job.proposals}
                      </p>
                      <p className="mt-1 text-xs text-[#EAE4D8]/42">Proposals</p>
                    </div>

                    <div className="flex justify-start xl:justify-end">
                      <Link
                        href={`/job/${job.id}`}
                        className="inline-flex h-11 min-w-[132px] items-center justify-center rounded-lg border border-[#C5A67C]/35 bg-black/10 px-5 text-sm font-semibold text-[#F0B84A] transition hover:border-[#F0B84A]/70 hover:bg-[#F0B84A]/10"
                      >
                        View Job
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
                  No jobs indexed yet
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#EAE4D8]/50">
                  This dashboard is ready. Wire the backend/indexer later to populate live marketplace jobs.
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
    </div>
  );
}
