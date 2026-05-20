'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { waitForTransactionReceipt } from '@wagmi/core';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useArcWrite } from '@/hooks/useArcWrite';
import {
  buildApproveUsdcConfig,
  buildCreateJobConfig,
  buildFundJobConfig,
  buildSetBudgetConfig,
} from '@arclayer/sdk';
import { StatusBanner } from '@/components/StatusBanner';
import { InlineProtectionNotice, useProtectionNotice, NOTICE_WORKER_EQUALS_CLIENT } from '@/components/protection';
import { formatUSDC, parseUSDC, shortenAddress } from '@/lib/contracts';
import { fetchIndexerJson, type IndexedAgent, type IndexedJob, waitForIndexer } from '@/lib/indexer';
import { config } from '@/lib/wagmi';
import { displayAgentLabel, formatSkillLabel, parseAgentSkill, shortAgentId } from '@/lib/agentName';
import { VaultDepositPanel } from '@/components/vault/VaultDepositPanel';
import { MilestoneProgressPanel } from '@/components/vault/MilestoneProgressPanel';
import { DisputeViewer } from '@/components/vault/DisputeViewer';
import {
  MANUAL_CATEGORIES,
  CATEGORY_KEYS,
  DELIVERY_TIMES,
  DIFFICULTIES,
  JOB_TEMPLATES,
  inferAgentCategory,
  inferManualJobCategory,
  getManualJobDisplay,
  categoryFromSlug,
  slugFromCategory,
  type ManualCategory,
  type ManualJobDisplay,
} from '@/lib/manualJobs';

const JOB_STATUS = ['Created', 'Budgeted', 'Funded', 'Submitted', 'Completed'] as const;
const JOB_TONE: Record<number, string> = { 0: '', 1: 'pending', 2: 'pending', 3: 'pending', 4: 'success' };

function isValidAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export default function JobsPageRoute() {
  return (
    <Suspense fallback={null}>
      <JobsPage />
    </Suspense>
  );
}

function JobsPage() {
  const searchParams = useSearchParams();
  const preselectedAgentId = (searchParams.get('agent') || searchParams.get('agentId'))?.trim() ?? '';
  const categoryParam = searchParams.get('category')?.trim() ?? '';
  const initialCategory =
    CATEGORY_KEYS.find((key) => key.toLowerCase() === categoryParam.toLowerCase()) ??
    categoryFromSlug(categoryParam) ??
    'Smart Contract';
  const templateParam = searchParams.get('template')?.trim() ?? '';
  const { address, isConnected } = useArcWallet();
  const { writeContractAsync } = useArcWrite();
  const { notify } = useProtectionNotice();
  const [jobs, setJobs] = useState<IndexedJob[]>([]);
  const [agents, setAgents] = useState<IndexedAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txState, setTxState] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'idle' | 'pending' | 'synced' | 'error'>('idle');
  const [createForm, setCreateForm] = useState({
    category: initialCategory,
    title: '',
    agentId: '',
    worker: '',
    evaluator: '',
    jobSpec: '',
    duration: '24 hours',
    difficulty: 'Medium',
  });
  const [workerTouched, setWorkerTouched] = useState(false);
  const [evaluatorTouched, setEvaluatorTouched] = useState(false);
  const [fundForm, setFundForm] = useState({ jobId: '', budget: '1', amount: '1' });
  const [depositTouched, setDepositTouched] = useState(false);
  const [createdJobId, setCreatedJobId] = useState<string>('');

  // Filter / sort state for job list
  const [jobSearch, setJobSearch] = useState('');
  const [jobCategoryFilter, setJobCategoryFilter] = useState<'All' | ManualCategory>('All');
  const [jobStatusFilter, setJobStatusFilter] = useState<'all' | '0' | '1' | '2' | '3' | '4' | '5' | '6'>('all');
  const [jobSort, setJobSort] = useState<'relevant' | 'newest' | 'budgetDesc' | 'budgetAsc' | 'settledFirst'>('relevant');
  const [myJobsOnly, setMyJobsOnly] = useState(false);
  const [showAllJobs, setShowAllJobs] = useState(false);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.agentId === createForm.agentId) ?? null,
    [agents, createForm.agentId]
  );

  const selectedAgentLabel = selectedAgent
    ? displayAgentLabel({ agentId: selectedAgent.agentId, metadataURI: selectedAgent.metadataURI })
    : null;
  const selectedAgentSkill = selectedAgent ? formatSkillLabel(parseAgentSkill(selectedAgent.metadataURI)) : null;

  const selectedFundingJob = useMemo(
    () => jobs.find((job) => job.id === fundForm.jobId) ?? null,
    [jobs, fundForm.jobId]
  );

  const agentById = useMemo(
    () => new Map(agents.map((a) => [a.agentId, a])),
    [agents]
  );

  const jobDisplays = useMemo(
    () => new Map(jobs.map((job) => [job.id, getManualJobDisplay(job, agentById.get(job.agentId) ?? null)])),
    [jobs, agentById]
  );

  const categoryStats = useMemo(() => {
    return MANUAL_CATEGORIES.map((category) => {
      const jobCount = jobs.filter((job) => jobDisplays.get(job.id)?.category === category.key).length;
      const agentCount = agents.filter((agent) => inferAgentCategory(agent) === category.key).length;
      return { ...category, jobCount, agentCount };
    });
  }, [jobs, agents, jobDisplays]);

  const filteredJobs = useMemo(() => {
    const q = jobSearch.trim().toLowerCase();
    const lower = address?.toLowerCase() ?? '';
    // Relevance: actionable first (Submitted > Evaluated > Funded > Budgeted > Created), terminal last.
    const relevance: Record<number, number> = { 3: 0, 4: 1, 2: 2, 1: 3, 0: 4, 5: 5, 6: 6 };
    const rows = jobs.filter((j) => {
      const display = jobDisplays.get(j.id) ?? getManualJobDisplay(j, agentById.get(j.agentId) ?? null);
      if (jobCategoryFilter !== 'All' && display.category !== jobCategoryFilter) return false;
      if (jobStatusFilter !== 'all' && j.status !== Number(jobStatusFilter)) return false;
      if (myJobsOnly && lower) {
        if (
          j.client.toLowerCase() !== lower &&
          j.worker.toLowerCase() !== lower &&
          j.evaluator.toLowerCase() !== lower
        ) {
          return false;
        }
      }
      if (!q) return true;
      const agent = agentById.get(j.agentId);
      const name = agent ? displayAgentLabel({ agentId: agent.agentId, metadataURI: agent.metadataURI }) : shortAgentId(j.agentId);
      const skill = agent ? (formatSkillLabel(parseAgentSkill(agent.metadataURI)) || parseAgentSkill(agent.metadataURI) || '') : '';
      const status = JOB_STATUS[j.status] || '';
      return [`#${j.id}`, j.id, j.agentId, shortAgentId(j.agentId), j.worker, j.client, j.evaluator, name, skill, status, display.category, display.title, display.description]
        .some((v) => String(v).toLowerCase().includes(q));
    });
    return rows.sort((a, b) => {
      if (jobSort === 'newest') return Number(BigInt(b.id) - BigInt(a.id));
      if (jobSort === 'budgetDesc') return Number(BigInt(b.budget) - BigInt(a.budget));
      if (jobSort === 'budgetAsc') return Number(BigInt(a.budget) - BigInt(b.budget));
      if (jobSort === 'settledFirst') return (b.status === 5 ? 1 : 0) - (a.status === 5 ? 1 : 0) || Number(BigInt(b.id) - BigInt(a.id));
      // 'relevant': actionable first, then newest
      return (relevance[a.status] ?? 9) - (relevance[b.status] ?? 9) || Number(BigInt(b.id) - BigInt(a.id));
    });
  }, [jobs, jobDisplays, jobSearch, jobCategoryFilter, jobStatusFilter, jobSort, myJobsOnly, address, agentById]);

  const visibleJobs = showAllJobs ? filteredJobs : filteredJobs.slice(0, 5);

  // Auto-fill worker with the selected agent's controller (most common case).
  useEffect(() => {
    if (!workerTouched && selectedAgent) {
      setCreateForm((current) =>
        current.worker === selectedAgent.controller ? current : { ...current, worker: selectedAgent.controller }
      );
    }
  }, [selectedAgent, workerTouched]);

  // Auto-fill client address (evaluator) with the connected wallet.
  useEffect(() => {
    if (!evaluatorTouched && address) {
      setCreateForm((current) =>
        current.evaluator.toLowerCase() === address.toLowerCase() ? current : { ...current, evaluator: address }
      );
    }
  }, [address, evaluatorTouched]);

  useEffect(() => {
    const template = JOB_TEMPLATES.find((item) => item.name.toLowerCase() === templateParam.toLowerCase());
    setCreateForm((current) => ({
      ...current,
      ...(template ? template : { category: initialCategory }),
    }));
    setJobCategoryFilter(initialCategory);
  }, [initialCategory, templateParam]);

  async function loadJobs() {
    setIsRefreshing(true);
    try {
      const [nextJobs, nextAgents] = await Promise.all([
        fetchIndexerJson<IndexedJob[]>('/jobs'),
        fetchIndexerJson<IndexedAgent[]>('/agents'),
      ]);
      setJobs(nextJobs);
      setAgents(nextAgents);
      setCreateForm((current) => ({
        ...current,
        agentId: current.agentId || preselectedAgentId || nextAgents[0]?.agentId || '',
      }));
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        setStatusTone('pending');
        const [nextJobs, nextAgents] = await Promise.all([
          fetchIndexerJson<IndexedJob[]>('/jobs'),
          fetchIndexerJson<IndexedAgent[]>('/agents'),
        ]);
        if (!cancelled) {
          setJobs(nextJobs);
          setAgents(nextAgents);
          setCreateForm((current) => ({
            ...current,
            agentId: preselectedAgentId || current.agentId || nextAgents[0]?.agentId || '',
          }));
          setStatusTone('synced');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load jobs.');
          setStatusTone('error');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preselectedAgentId]);

  useEffect(() => {
    if (!depositTouched) {
      setFundForm((current) => (current.amount === current.budget ? current : { ...current, amount: current.budget }));
    }
  }, [fundForm.budget, depositTouched]);

  async function handleCreateJob() {
    if (!createForm.category) {
      setStatusTone('error');
      setTxState('Job category is required.');
      return;
    }
    if (!createForm.title.trim()) {
      setStatusTone('error');
      setTxState('Job title is required.');
      return;
    }
    if (!createForm.agentId) {
      setStatusTone('error');
      setTxState('Register an agent first, then select it here.');
      return;
    }
    if (!isValidAddress(createForm.worker)) {
      setStatusTone('error');
      setTxState('Worker address must be a valid 0x wallet.');
      return;
    }
    if (!isValidAddress(createForm.evaluator)) {
      setStatusTone('error');
      setTxState('Client address must be a valid 0x wallet.');
      return;
    }
    if (!createForm.jobSpec.trim()) {
      setStatusTone('error');
      setTxState('Task Description cannot be empty.');
      return;
    }
    if (createForm.worker.toLowerCase() === createForm.evaluator.toLowerCase()) {
      setStatusTone('error');
      setTxState('Worker and client cannot be the same address.');
      notify(NOTICE_WORKER_EQUALS_CLIENT);
      return;
    }

    try {
      setIsCreating(true);
      setStatusTone('pending');
      setCreatedJobId('');

      const structuredSpec = {
        category: createForm.category,
        title: createForm.title.trim(),
        description: createForm.jobSpec.trim(),
        duration: createForm.duration,
        difficulty: createForm.difficulty,
        agentId: createForm.agentId,
        worker: createForm.worker.trim(),
        client: createForm.evaluator.trim(),
        createdAt: new Date().toISOString(),
      };
      setTxState('Submitting createJob transaction\u2026');
      // ERC-8183 official: createJob(provider, evaluator, expiredAt, description, hook)
      const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60);
      const hash = await writeContractAsync(
        buildCreateJobConfig(
          createForm.worker.trim() as `0x${string}`,
          createForm.evaluator.trim() as `0x${string}`,
          expiredAt,
          JSON.stringify(structuredSpec),
        )
      );
      setTxState(`Waiting for ${hash.slice(0, 10)}\u2026`);
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh\u2026');
      const next = await waitForIndexer<IndexedJob[]>(
        '/jobs',
        (payload) => payload.some(
          (j) =>
            j.agentId === createForm.agentId &&
            j.worker.toLowerCase() === createForm.worker.toLowerCase() &&
            j.evaluator.toLowerCase() === createForm.evaluator.toLowerCase()
        )
      );
      setJobs(next);
      const createdJob = [...next].reverse().find(
        (j) =>
          j.agentId === createForm.agentId &&
          j.worker.toLowerCase() === createForm.worker.toLowerCase() &&
          j.evaluator.toLowerCase() === createForm.evaluator.toLowerCase()
      );
      setStatusTone('synced');
      setTxState(createdJob ? `Job #${createdJob.id} created and indexed.` : 'Job created and indexed.');
      if (createdJob) {
        setCreatedJobId(createdJob.id);
        setFundForm((current) => ({ ...current, jobId: createdJob.id }));
      }
    } catch (e) {
      setTxState(e instanceof Error ? e.message : 'createJob failed.');
      setStatusTone('error');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleFundJob() {
    if (!fundForm.jobId.trim()) {
      setStatusTone('error');
      setTxState('Enter a Job ID first.');
      return;
    }

    try {
      setIsFunding(true);
      setStatusTone('pending');
      const budget = parseUSDC(fundForm.budget);
      const amount = parseUSDC(fundForm.amount);
      const jobId = BigInt(fundForm.jobId);

      setTxState('Setting budget\u2026');
      const b = await writeContractAsync(buildSetBudgetConfig(jobId, budget));
      await waitForTransactionReceipt(config, { hash: b });

      setTxState('Approving USDC\u2026');
      const a = await writeContractAsync(buildApproveUsdcConfig(amount));
      await waitForTransactionReceipt(config, { hash: a });

      setTxState('Funding Settlement Vault\u2026');
      const f = await writeContractAsync(buildFundJobConfig(jobId, amount));
      await waitForTransactionReceipt(config, { hash: f });

      setTxState('Funding receipt confirmed. Waiting for indexer refresh\u2026');
      const next = await waitForIndexer<IndexedJob[]>(
        '/jobs',
        (payload) => payload.some((j) => j.id === fundForm.jobId && j.fundedAmount === amount.toString())
      );
      setJobs(next);
      setStatusTone('synced');
      setTxState('Budget set, USDC approved, and Deposit Amount funded into the Settlement Vault.');
    } catch (e) {
      setTxState(e instanceof Error ? e.message : 'Funding flow failed.');
      setStatusTone('error');
    } finally {
      setIsFunding(false);
    }
  }

  const customWorker = !!(selectedAgent && createForm.worker && createForm.worker.toLowerCase() !== selectedAgent.controller.toLowerCase());
  const customClient = !!(address && createForm.evaluator && createForm.evaluator.toLowerCase() !== address.toLowerCase());

  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="mb-8">
          <div className="aureo-mono-label mb-3">PROTOCOL · JOBS</div>
          <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
            Manual <span className="italic text-[#C5A67C]">Job</span>
          </h1>
          <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.85)] invisible">
            Pick an agent, assign a task, set a USDC budget, and lock funds in the Settlement Vault.
          </p>
        </div>

        <div className="mb-5 overflow-x-auto border-y border-white/10 py-2">
          <nav className="flex min-w-max gap-2" aria-label="Manual job sections">
            {[['Overview', '#overview'], ['Categories', '#categories'], ['Job Board', '#job-board'], ['Create Job', '#create-job'], ['Approve & Fund', '#fund-job'], ['Advanced Escrow', '#advanced-escrow']].map(([label, href]) => (
              <a key={href} href={href} className="btn-bordered px-3 py-2 text-[9.5px]">{label}</a>
            ))}
          </nav>
        </div>

        <section id="overview" className="mb-5">
          <div className="flex flex-wrap gap-3">
            <button onClick={() => loadJobs()} className="btn-bordered">
              {isRefreshing ? 'REFRESHING\u2026' : 'REFRESH'}
            </button>
            <Link href="/register/manual" className="btn-primary">REGISTER AGENT</Link>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-l-2 border-[#C5A67C]/40 pl-4 font-mono text-[10.5px] text-[rgba(234,228,216,0.84)]">
            <span>Pick an agent, assign a task, lock USDC.</span>
            <span className="text-[rgba(234,228,216,0.85)]">&middot;</span>
            <span>x402 is not job funding.</span>
            <span className="text-[rgba(234,228,216,0.85)]">&middot;</span>
            <span>Escrow = approve, fund, release USDC.</span>
          </div>
        </section>

        <section id="categories" className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="aureo-mono-label mb-1">MARKETPLACE</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Categories</h2>
            </div>
            <span className="font-mono text-[10px] text-[#C5A67C]">{jobs.length} jobs · {agents.length} agents</span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {categoryStats.map((cat) => (
              <Link
                key={cat.key}
                href={`/jobs/manual/${slugFromCategory(cat.key)}`}
                className="group min-h-[126px] rounded-sm border border-white/[0.07] bg-black/25 p-3 text-left transition hover:border-[#C5A67C]/35 hover:bg-white/[0.035]"
              >
                <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-[#EAE4D8]">{cat.key}</div>
                <div className="mt-2 line-clamp-2 text-[10.5px] leading-snug text-[rgba(234,228,216,0.78)] invisible">{cat.copy}</div>
                <div className="mt-3 flex flex-wrap gap-1 font-mono text-[9px] uppercase tracking-[0.12em]">
                  <span className="chip-status pending">{cat.jobCount} jobs</span>
                  <span className="chip-status">{cat.agentCount} agents</span>
                </div>
                <div className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#C5A67C]">Open category →</div>
              </Link>
            ))}
          </div>
        </section>

        {/* Connected wallet badge */}
        {isConnected && address && (
          <div className="mb-5 inline-flex items-center gap-2 border border-[rgba(184,205,126,0.35)] bg-[rgba(184,205,126,0.06)] px-3 py-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.85)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#B8CD7E]" />
            Connected as <span className="text-[#EAE4D8]">{shortenAddress(address)}</span>
            <span className="text-[rgba(234,228,216,0.84)]">&middot;</span>
            <span className="text-[#C5A67C]">Client</span>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4" style={{ border: '1px solid rgba(230, 130, 130, 0.35)', background: 'rgba(230, 130, 130, 0.06)' }}>
            <p className="font-mono text-[11.5px] text-[#f0c5c5]">{error}</p>
          </div>
        )}

        <div className="mb-6">
          <StatusBanner
            tone={statusTone}
            title={
              statusTone === 'pending'
                ? 'PENDING · CONFIRMATION'
                : statusTone === 'synced'
                  ? 'INDEXER · SYNCED'
                  : statusTone === 'error'
                    ? 'ACTION · ERROR'
                    : 'READY'
            }
            body={txState || (isRefreshing ? 'Refreshing indexed jobs.' : 'Ready for create / fund flow.')}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.08fr_0.92fr]">
          <section id="job-board" className="aureo-panel scroll-mt-4 p-4 md:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="aureo-mono-label mb-2">LIVE ESCROW JOBS</div>
                <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Job cards</h2>
              </div>
              <span className="font-mono text-[11px] text-[#EAE4D8]">
                {filteredJobs.length}
                <span className="text-[#C5A67C]"> / {jobs.length} </span>
                indexed
              </span>
            </div>
            <p className="mt-2 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.82)] invisible">
              Create, fund, review, and settle jobs.
            </p>

            {/* Filter / sort bar */}
            <div className="mt-4 space-y-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-2">
                <input
                  value={jobSearch}
                  onChange={(e) => setJobSearch(e.target.value)}
                  placeholder="Search job ID, agent, worker, client…"
                  className="input-mono flex-1"
                  autoComplete="off"
                  spellCheck={false}
                />
                <select
                  value={jobSort}
                  onChange={(e) => setJobSort(e.target.value as typeof jobSort)}
                  className="input-mono md:w-[180px]"
                  title="Sort jobs"
                >
                  <option value="relevant">Most relevant</option>
                  <option value="newest">Newest</option>
                  <option value="budgetDesc">Highest budget</option>
                  <option value="budgetAsc">Lowest budget</option>
                  <option value="settledFirst">Settled first</option>
                </select>
                <button
                  type="button"
                  onClick={() => setMyJobsOnly((v) => !v)}
                  disabled={!address}
                  className={`btn-bordered px-3 py-2 text-[10px] ${myJobsOnly ? 'border-[#C5A67C] text-[#C5A67C]' : ''}`}
                  title={address ? 'Show jobs where this wallet is client, worker, or evaluator' : 'Connect wallet to filter your jobs'}
                >
                  MY JOBS
                </button>
              </div>

              <div>
                <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.65)]">Marketplace filter</div>
                <div className="flex flex-wrap gap-2">
                  {(['All', ...CATEGORY_KEYS] as const).map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setJobCategoryFilter(category)}
                      className={`chip-status ${jobCategoryFilter === category ? 'border-[#C5A67C] text-[#EAE4D8]' : ''}`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="w-full font-mono text-[9px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.65)]">Escrow state</span>
                {(['all', '0', '1', '2', '3', '4', '5', '6'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setJobStatusFilter(status)}
                    className={`chip-status ${status === 'all' ? '' : JOB_TONE[Number(status)] ?? 'pending'} ${jobStatusFilter === status ? 'border-[#C5A67C] text-[#EAE4D8]' : ''}`}
                    title={status === 'all' ? 'Show all jobs' : `Show ${JOB_STATUS[Number(status)]} jobs`}
                  >
                    {status === 'all' ? 'All' : JOB_STATUS[Number(status)]}
                  </button>
                ))}
                {(jobSearch || jobCategoryFilter !== 'All' || jobStatusFilter !== 'all' || myJobsOnly) && (
                  <button
                    type="button"
                    onClick={() => {
                      setJobSearch('');
                      setJobCategoryFilter('All');
                      setJobStatusFilter('all');
                      setMyJobsOnly(false);
                    }}
                    className="btn-bordered px-3 py-2 text-[10px]"
                    title="Clear filters"
                  >
                    CLEAR
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {isLoading ? (
                [0, 1, 2, 3].map((i) => (
                  <div key={`skel-${i}`} className="aureo-skel block px-4 py-3 md:px-5 md:py-4">
                    <div className="flex items-center justify-between gap-4">
                      <span className="aureo-skel-bar" style={{ width: '92px' }} />
                      <span className="aureo-skel-bar" style={{ width: '86px' }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4">
                      <span className="aureo-skel-bar" style={{ width: '140px', height: '8px' }} />
                      <span className="aureo-skel-bar" style={{ width: '68px', height: '8px' }} />
                    </div>
                  </div>
                ))
              ) : filteredJobs.length > 0 ? (
                visibleJobs.map((job) => {
                  const agent = agentById.get(job.agentId) ?? null;
                  const agentLabel = agent ? displayAgentLabel({ agentId: agent.agentId, metadataURI: agent.metadataURI }) : shortAgentId(job.agentId);
                  const skill = agent ? formatSkillLabel(parseAgentSkill(agent.metadataURI)) : null;
                  const display = jobDisplays.get(job.id) ?? getManualJobDisplay(job, agent);
                  return (
                    <div key={job.id} className="aureo-list-card px-4 py-3 md:px-5 md:py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="mb-1 flex flex-wrap gap-2">
                            <span className="chip-status pending">{display.category}</span>
                            {!display.isStructured && <span className="chip-status">Legacy</span>}
                          </div>
                          <Link href={`/job/${job.id}`} className="font-mono text-[12.5px] text-[#EAE4D8] hover:text-[#C5A67C]">{display.title}</Link>
                          <div className="mt-1 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)]">
                            Job #{job.id} · {agentLabel}{skill ? ` · ${skill}` : ''}
                          </div>
                          <div className="mt-1 line-clamp-2 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)] invisible">{display.description}</div>
                          <div className="mt-1 font-mono text-[9.5px] text-[rgba(234,228,216,0.65)]">{display.duration} · {display.difficulty}</div>
                          <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px]">
                            <Link href={`/a2a/agents/${job.agentId}`} className="text-[#C5A67C] hover:text-[#EAE4D8]">View agent profile</Link>
                            <span className="text-[#555]">·</span>
                            <Link href={`/job/${job.id}`} className="text-[#C5A67C] hover:text-[#EAE4D8]">Open job</Link>
                            <span className="text-[#555]">·</span>
                            <button type="button" onClick={() => { setCreateForm((c) => ({ ...c, agentId: job.agentId, category: display.category, title: display.isStructured ? display.title : '', jobSpec: display.isStructured ? display.description : '' })); document.getElementById('create-job')?.scrollIntoView({ behavior: 'smooth' }); }} className="text-[#777] hover:text-[#C5A67C]">Use agent</button>
                          </div>
                        </div>
                        <span className={`chip-status ${JOB_TONE[job.status] ?? 'pending'}`}>{JOB_STATUS[job.status]}</span>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-none border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.28)] px-3 py-2">
                          <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.85)]">Budget</div>
                          <div className="mt-1 font-mono text-[11px] text-[#EAE4D8]">{formatUSDC(BigInt(job.budget))} USDC</div>
                        </div>
                        <div className="rounded-none border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.28)] px-3 py-2">
                          <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.85)]">Deposit Amount</div>
                          <div className="mt-1 font-mono text-[11px] text-[#EAE4D8]">{formatUSDC(BigInt(job.fundedAmount))} USDC</div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="font-mono text-[10px] text-[rgba(234,228,216,0.85)]">Worker {shortenAddress(job.worker)}</div>
                        <div className="font-mono text-[10px] text-[rgba(234,228,216,0.85)]">Client {shortenAddress(job.evaluator)}</div>
                      </div>
                      <div className="mt-2 font-mono text-[10px] text-[rgba(234,228,216,0.85)]">Settlement {job.proofMetadataURI ? 'recorded' : job.status === 4 ? 'pending' : 'not yet'}</div>
                    </div>
                  );
                })
              ) : (
                <div className="aureo-empty">
                  <span className="aureo-empty-glyph">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" /></svg>
                  </span>
                  {jobs.length > 0 ? (
                    <>
                      <p className="font-mono text-[11.5px] text-[#EAE4D8]">No jobs match your filter</p>
                      <p className="font-mono text-[10.5px] text-[rgba(234,228,216,0.78)]">Try a different keyword or clear the filter.</p>
                    </>
                  ) : (
                    <>
                      <p className="font-mono text-[11.5px] text-[#EAE4D8]">No indexed jobs yet</p>
                      <p className="font-mono text-[10.5px] text-[rgba(234,228,216,0.78)]">Create the first funded job.</p>
                    </>
                  )}
                </div>
              )}
              {filteredJobs.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllJobs((v) => !v)}
                  className="font-mono text-[10.5px] uppercase tracking-[0.18em]"
                  style={{ color: '#C5A67C' }}
                >
                  {showAllJobs ? `Show less ↑` : `Show all (${filteredJobs.length}) ↓`}
                </button>
              )}
            </div>
          </section>

          <section className="space-y-6">
            <section id="create-job" className="aureo-panel scroll-mt-4 p-4 md:p-6">
              <div className="flex items-center gap-2">
                <div className="aureo-mono-label">STEP 1</div>
                {createdJobId && (
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#B8CD7E] text-[#0a0a0a]" title="Step 1 complete">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </span>
                )}
              </div>
              <h2 className="mt-2 aureo-display text-[28px] text-[#EAE4D8]">Create job assignment</h2>
              <p className="mt-1 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.78)] invisible">
                Assign work to a registered agent.
              </p>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {JOB_TEMPLATES.map((template) => (
                  <button
                    key={template.name}
                    type="button"
                    onClick={() => setCreateForm((c) => ({ ...c, ...template }))}
                    className="btn-bordered px-3 py-2 text-[9.5px]"
                  >
                    {template.name}
                  </button>
                ))}
              </div>

              <div className="mt-5 space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">JOB CATEGORY</label>
                    <select value={createForm.category} onChange={(e) => setCreateForm((c) => ({ ...c, category: e.target.value as ManualCategory }))} className="input-mono">
                      {CATEGORY_KEYS.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">JOB TITLE</label>
                    <input value={createForm.title} onChange={(e) => setCreateForm((c) => ({ ...c, title: e.target.value }))} placeholder="Short task title" className="input-mono" />
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">DELIVERY TIME</label>
                    <select value={createForm.duration} onChange={(e) => setCreateForm((c) => ({ ...c, duration: e.target.value }))} className="input-mono">
                      {DELIVERY_TIMES.map((time) => <option key={time} value={time}>{time}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">DIFFICULTY</label>
                    <select value={createForm.difficulty} onChange={(e) => setCreateForm((c) => ({ ...c, difficulty: e.target.value }))} className="input-mono">
                      {DIFFICULTIES.map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">SELECT REGISTERED AGENT</label>
                  <select
                    value={createForm.agentId}
                    onChange={(e) => {
                      setWorkerTouched(false);
                      setCreateForm((c) => ({ ...c, agentId: e.target.value }));
                    }}
                    className="input-mono"
                  >
                    {agents.length === 0 ? (
                      <option value="">No registered agents yet</option>
                    ) : (
                      agents.map((agent) => {
                        const label = displayAgentLabel({ agentId: agent.agentId, metadataURI: agent.metadataURI });
                        const skill = formatSkillLabel(parseAgentSkill(agent.metadataURI));
                        return (
                          <option key={agent.agentId} value={agent.agentId}>
                            {label}{skill ? ` — ${skill}` : ''}
                          </option>
                        );
                      })
                    )}
                  </select>
                  {selectedAgent ? (
                    <div className="mt-2 border border-[rgba(197,166,124,0.25)] bg-[rgba(197,166,124,0.04)] px-3 py-2">
                      <div className="font-mono text-[11px] text-[#EAE4D8]">
                        {selectedAgentLabel}{selectedAgentSkill ? <span className="text-[rgba(234,228,216,0.84)]"> &middot; {selectedAgentSkill}</span> : null}
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-[rgba(234,228,216,0.85)]">
                        Controller {shortenAddress(selectedAgent.controller)}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.85)]">
                      Register an agent first.
                    </div>
                  )}
                </div>

                {agents.length === 0 && (
                  <div>
                    <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">MANUAL AGENT ID</label>
                    <input
                      value={createForm.agentId}
                      onChange={(e) => setCreateForm((c) => ({ ...c, agentId: e.target.value }))}
                      placeholder="Paste full agent ID if indexer is empty"
                      className="input-mono"
                    />
                    <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.85)]">Fallback if the indexer is empty.</div>
                  </div>
                )}

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">WORKER ADDRESS</label>
                    {customWorker && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#C5A67C]">Custom worker</span>
                    )}
                  </div>
                  <input
                    value={createForm.worker}
                    onChange={(e) => {
                      setWorkerTouched(true);
                      setCreateForm((c) => ({ ...c, worker: e.target.value }));
                    }}
                    placeholder={selectedAgent ? selectedAgent.controller : '0x... worker wallet'}
                    className="input-mono"
                  />
                  <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.85)]">
                    {selectedAgent && !customWorker
                      ? 'Auto-filled from selected agent.'
                      : 'Worker and client cannot be the same address.'}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">CLIENT ADDRESS</label>
                    {customClient && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#C5A67C]">Custom evaluator</span>
                    )}
                  </div>
                  <input
                    value={createForm.evaluator}
                    onChange={(e) => {
                      setEvaluatorTouched(true);
                      setCreateForm((c) => ({ ...c, evaluator: e.target.value }));
                    }}
                    placeholder={address ? address : 'Connect wallet to auto-fill'}
                    className="input-mono"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">TASK DESCRIPTION</label>
                  <textarea
                    value={createForm.jobSpec}
                    onChange={(e) => setCreateForm((c) => ({ ...c, jobSpec: e.target.value }))}
                    placeholder={'Example: Audit the Settlement Vault and deliver an IPFS report.'}
                    className="input-mono min-h-[120px]"
                  />
                </div>

              </div>

              {createForm.worker && createForm.evaluator && createForm.worker.toLowerCase() === createForm.evaluator.toLowerCase() && (
                <InlineProtectionNotice {...NOTICE_WORKER_EQUALS_CLIENT} className="mt-4" />
              )}

              <button onClick={handleCreateJob} disabled={!isConnected || isCreating || isFunding} className="btn-primary mt-5">
                {isCreating ? 'CREATING\u2026' : 'CREATE JOB'}
              </button>

              <details className="mt-4 group border-t border-white/5 pt-3">
                <summary className="cursor-pointer font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.85)] transition hover:text-[rgba(234,228,216,0.82)]">
                  Developer details
                </summary>
                <div className="mt-2 font-mono text-[9.5px] leading-4 text-[rgba(234,228,216,0.85)] invisible">
                  <code className="text-[rgba(234,228,216,0.85)]">createJob(agentId, worker, evaluator, taskDescription)</code> — &ldquo;Client Address&rdquo; maps to the <code className="text-[rgba(234,228,216,0.85)]">evaluator</code> contract parameter.
                </div>
              </details>

              {createdJobId && (
                <div className="mt-4 rounded-none border border-[rgba(184,205,126,0.35)] bg-[rgba(184,205,126,0.08)] p-4">
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#B8CD7E]">Step 1 complete</div>
                  <div className="mt-2 font-mono text-[12px] text-[#EAE4D8]">Job #{createdJobId} created</div>
                  <div className="mt-1 font-mono text-[10.5px] text-[rgba(234,228,216,0.82)]">Step 2 is ready.</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/job/${createdJobId}`} className="btn-bordered px-3 py-2 text-[9.5px]">OPEN JOB DETAIL</Link>
                    <button type="button" onClick={() => setFundForm((current) => ({ ...current, jobId: createdJobId }))} className="btn-primary px-3 py-2 text-[9.5px]">USE IN FUND STEP</button>
                  </div>
                </div>
              )}
            </section>

            <section id="fund-job" className="aureo-panel scroll-mt-4 p-4 md:p-6">
              <div className="aureo-mono-label mb-2">STEP 2</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Approve &amp; fund Settlement Vault</h2>
              <p className="mt-1 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.78)] invisible">
                Lock USDC until work is approved.
              </p>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">JOB ID</label>
                  <input
                    value={fundForm.jobId}
                    onChange={(e) => setFundForm((c) => ({ ...c, jobId: e.target.value }))}
                    placeholder="Job ID to budget and fund"
                    className="input-mono"
                  />
                  <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.85)]">Auto-filled after Step 1.</div>
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">BUDGET AMOUNT (USDC)</label>
                  <input
                    value={fundForm.budget}
                    onChange={(e) => setFundForm((c) => ({ ...c, budget: e.target.value }))}
                    placeholder="1"
                    className="input-mono"
                  />
                  <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.85)]">Agreed job price.</div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.82)]">DEPOSIT AMOUNT (USDC)</label>
                    {depositTouched && fundForm.amount !== fundForm.budget && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#C5A67C]">Custom deposit</span>
                    )}
                  </div>
                  <input
                    value={fundForm.amount}
                    onChange={(e) => {
                      setDepositTouched(true);
                      setFundForm((c) => ({ ...c, amount: e.target.value }));
                    }}
                    placeholder="1"
                    className="input-mono"
                  />
                  <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.85)]">USDC locked for this job.</div>
                </div>

                {selectedFundingJob && (
                  <div className="rounded-none border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.3)] px-4 py-3">
                    <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.85)]">Funding Preview</div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div className="font-mono text-[10.5px] text-[#EAE4D8]">Status {JOB_STATUS[selectedFundingJob.status]}</div>
                      <div className="font-mono text-[10.5px] text-[#EAE4D8]">Worker {shortenAddress(selectedFundingJob.worker)}</div>
                    </div>
                  </div>
                )}
              </div>

              <button onClick={handleFundJob} disabled={!isConnected || isCreating || isFunding} className="btn-primary mt-5">
                {isFunding ? 'FUNDING\u2026' : 'APPROVE & FUND'}
              </button>

              <details className="mt-4 group border-t border-white/5 pt-3">
                <summary className="cursor-pointer font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.85)] transition hover:text-[rgba(234,228,216,0.82)]">
                  Developer details
                </summary>
                <div className="mt-2 font-mono text-[9.5px] leading-4 text-[rgba(234,228,216,0.85)]">
                  <code className="text-[rgba(234,228,216,0.85)]">setBudget &rarr; approve(USDC) &rarr; fund(jobId, amount)</code>
                </div>
              </details>
            </section>

            <details id="advanced-escrow" className="aureo-panel scroll-mt-4 p-4 md:p-6">
              <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.18em] text-[#C5A67C]">Advanced Escrow Tools</summary>
              <div className="mt-4 space-y-4">
                <VaultDepositPanel />
                <MilestoneProgressPanel />
                <DisputeViewer />
              </div>
            </details>

            <div className="rounded-none border border-[rgba(255,255,255,0.08)] bg-[rgba(10,10,10,0.6)] p-5 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.82)]">
              {isConnected
                ? '\u2713 Wallet connected. Manual flow: Select Agent \u2192 Create Job \u2192 Fund \u2192 Submit Deliverable \u2192 Complete \u2192 Settlement recorded.'
                : '\u26a0 Connect wallet to submit protocol writes.'}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
