'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { waitForTransactionReceipt } from '@wagmi/core';
import { useAccount, useWriteContract } from 'wagmi';
import {
  buildApproveUsdcConfig,
  buildCreateJobConfig,
  buildFundJobConfig,
  buildSetBudgetConfig,
} from '@arclayer/sdk';
import { StatusBanner } from '@/components/StatusBanner';
import { formatUSDC, parseUSDC, shortenAddress } from '@/lib/contracts';
import { fetchIndexerJson, type IndexedAgent, type IndexedJob, waitForIndexer } from '@/lib/indexer';
import { config } from '@/lib/wagmi';
import { displayAgentLabel, shortAgentId } from '@/lib/agentName';

const JOB_STATUS = ['Created', 'Budgeted', 'Funded', 'Submitted', 'Evaluated', 'Settled', 'Cancelled'] as const;
const JOB_TONE: Record<number, string> = { 0: '', 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'success', 6: 'error' };

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
  const preselectedAgentId = searchParams.get('agentId')?.trim() ?? '';
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
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
    agentId: '',
    worker: '',
    evaluator: '',
    jobSpec: '',
  });
  const [fundForm, setFundForm] = useState({ jobId: '', budget: '1', amount: '1' });
  const [depositTouched, setDepositTouched] = useState(false);
  const [createdJobId, setCreatedJobId] = useState<string>('');

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.agentId === createForm.agentId) ?? null,
    [agents, createForm.agentId]
  );

  const selectedFundingJob = useMemo(
    () => jobs.find((job) => job.id === fundForm.jobId) ?? null,
    [jobs, fundForm.jobId]
  );

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
      setTxState('Evaluator address must be a valid 0x wallet.');
      return;
    }
    if (!createForm.jobSpec.trim()) {
      setStatusTone('error');
      setTxState('Task Description cannot be empty.');
      return;
    }

    try {
      setIsCreating(true);
      setStatusTone('pending');
      setCreatedJobId('');

      if (address && createForm.worker.toLowerCase() == address.toLowerCase()) {
        setTxState('Worker address cannot be the same as your connected wallet (client). Use a different worker address.');
        setStatusTone('error');
        return;
      }
      if (address && createForm.evaluator.toLowerCase() == address.toLowerCase()) {
        setTxState('Evaluator address cannot be the same as your connected wallet (client). Use a different evaluator address.');
        setStatusTone('error');
        return;
      }

      setTxState('Submitting createJob transaction…');
      const hash = await writeContractAsync(
        buildCreateJobConfig(
          BigInt(createForm.agentId),
          createForm.worker.trim() as `0x${string}`,
          createForm.evaluator.trim() as `0x${string}`,
          createForm.jobSpec.trim()
        )
      );
      setTxState(`Waiting for ${hash.slice(0, 10)}…`);
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh…');
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

      setTxState('Setting budget…');
      const b = await writeContractAsync(buildSetBudgetConfig(jobId, budget));
      await waitForTransactionReceipt(config, { hash: b });

      setTxState('Approving USDC…');
      const a = await writeContractAsync(buildApproveUsdcConfig(amount));
      await waitForTransactionReceipt(config, { hash: a });

      setTxState('Funding Settlement Vault…');
      const f = await writeContractAsync(buildFundJobConfig(jobId, amount));
      await waitForTransactionReceipt(config, { hash: f });

      setTxState('Funding receipt confirmed. Waiting for indexer refresh…');
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

  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="aureo-mono-label mb-3">PROTOCOL · JOBS</div>
            <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
              Create and fund a <span className="italic text-[#C5A67C]">job</span>
            </h1>
            <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.68)]">
              First select a registered agent. Then write the Task Description, set the budget, and deposit USDC into the Settlement Vault.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 self-start md:self-auto">
            <button onClick={() => loadJobs()} className="btn-bordered">
              {isRefreshing ? 'REFRESHING…' : 'REFRESH'}
            </button>
            <Link href="/agents" className="btn-primary">BACK TO AGENTS</Link>
          </div>
        </div>

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
          <section className="aureo-panel p-4 md:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="aureo-mono-label mb-2">STEP 3 · LIVE JOBS</div>
                <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Job cards</h2>
              </div>
              <span className="font-mono text-[11px] text-[#C5A67C]">{jobs.length} indexed</span>
            </div>
            <p className="mt-2 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.58)]">
              Track Create → Budget → Fund → Submit → Evaluate → Settle, with the selected agent, worker, and funding state visible in one place.
            </p>
            <div className="mt-5 space-y-3">
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
              ) : jobs.length > 0 ? (
                jobs.map((job) => {
                  const agent = agents.find((candidate) => candidate.agentId === job.agentId) ?? null;
                  const agentLabel = agent ? displayAgentLabel({ agentId: agent.agentId, metadataURI: agent.metadataURI }) : shortAgentId(job.agentId);
                  return (
                    <Link key={job.id} href={`/job/${job.id}`} className="aureo-list-card block px-4 py-3 md:px-5 md:py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-mono text-[12.5px] text-[#EAE4D8]">Job #{job.id}</div>
                          <div className="mt-1 font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">{agentLabel} · {shortAgentId(job.agentId)}</div>
                        </div>
                        <span className={`chip-status ${JOB_TONE[job.status] ?? 'pending'}`}>{JOB_STATUS[job.status]}</span>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="rounded-none border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.28)] px-3 py-2">
                          <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.52)]">Budget</div>
                          <div className="mt-1 font-mono text-[11px] text-[#EAE4D8]">{formatUSDC(BigInt(job.budget))} USDC</div>
                        </div>
                        <div className="rounded-none border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.28)] px-3 py-2">
                          <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.52)]">Deposit Amount</div>
                          <div className="mt-1 font-mono text-[11px] text-[#EAE4D8]">{formatUSDC(BigInt(job.fundedAmount))} USDC</div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <div className="font-mono text-[10px] text-[rgba(234,228,216,0.68)]">Worker {shortenAddress(job.worker)}</div>
                        <div className="font-mono text-[10px] text-[rgba(234,228,216,0.68)]">Evaluator {shortenAddress(job.evaluator)}</div>
                      </div>
                      <div className="mt-2 font-mono text-[10px] text-[rgba(234,228,216,0.52)]">Proof of Work {job.proofMetadataURI ? 'available' : job.status === 5 ? 'pending metadata' : 'not minted yet'}</div>
                    </Link>
                  );
                })
              ) : (
                <div className="aureo-empty">
                  <span className="aureo-empty-glyph">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" /></svg>
                  </span>
                  <p className="font-mono text-[11.5px] text-[#EAE4D8]">No indexed jobs yet</p>
                  <p className="font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">Follow Step 1 and Step 2 on the right to create the first funded job.</p>
                </div>
              )}
            </div>
          </section>

          <section className="space-y-6">
            <div className="aureo-panel p-4 md:p-6">
              <div className="aureo-mono-label mb-2">STEP 1 · SELECT REGISTERED AGENT</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Create job</h2>
              <code className="mt-2 block font-mono text-[10.5px] text-[rgba(234,228,216,0.52)]">Settlement Vault · createJob(agentId, worker, evaluator, taskDescription)</code>
              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.68)]">SELECT REGISTERED AGENT</label>
                  <select
                    value={createForm.agentId}
                    onChange={(e) => setCreateForm((c) => ({ ...c, agentId: e.target.value }))}
                    className="input-mono"
                  >
                    {agents.length === 0 ? (
                      <option value="">No registered agents yet</option>
                    ) : (
                      agents.map((agent) => (
                        <option key={agent.agentId} value={agent.agentId}>
                          {displayAgentLabel({ agentId: agent.agentId, metadataURI: agent.metadataURI })} · {shortAgentId(agent.agentId)}
                        </option>
                      ))
                    )}
                  </select>
                  <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">
                    {selectedAgent
                      ? `Selected full ID ${selectedAgent.agentId}. Controller ${shortenAddress(selectedAgent.controller)}.`
                      : 'Register an agent first on the Agents page, then return here.'}
                  </div>
                </div>

                {agents.length === 0 && (
                  <div>
                    <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.68)]">MANUAL AGENT ID</label>
                    <input
                      value={createForm.agentId}
                      onChange={(e) => setCreateForm((c) => ({ ...c, agentId: e.target.value }))}
                      placeholder="Paste full agent ID if indexer is empty"
                      className="input-mono"
                    />
                    <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">Fallback only. This appears when the registered-agent list is unavailable or still empty.</div>
                  </div>
                )}

                <div>
                  <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.68)]">WORKER ADDRESS</label>
                  <input
                    value={createForm.worker}
                    onChange={(e) => setCreateForm((c) => ({ ...c, worker: e.target.value }))}
                    placeholder="0x... worker wallet"
                    className="input-mono"
                  />
                  <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">Use a worker wallet different from the connected client wallet. The contract rejects worker == client.</div>
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.68)]">EVALUATOR ADDRESS</label>
                  <input
                    value={createForm.evaluator}
                    onChange={(e) => setCreateForm((c) => ({ ...c, evaluator: e.target.value }))}
                    placeholder="0x... evaluator wallet"
                    className="input-mono"
                  />
                  <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">Optional workflow choice, but if used, keep it different from the connected client wallet for clean role separation.</div>
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.68)]">TASK DESCRIPTION</label>
                  <textarea
                    value={createForm.jobSpec}
                    onChange={(e) => setCreateForm((c) => ({ ...c, jobSpec: e.target.value }))}
                    placeholder="Describe exactly what the agent should do"
                    className="input-mono min-h-[120px]"
                  />
                  <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">This is the human-readable instruction used to create the job intent.</div>
                </div>
              </div>
              <button onClick={handleCreateJob} disabled={!isConnected || isCreating || isFunding} className="btn-primary mt-5">
                {isCreating ? 'CREATING…' : 'CREATE JOB'}
              </button>

              {createdJobId && (
                <div className="mt-4 rounded-none border border-[rgba(184,205,126,0.35)] bg-[rgba(184,205,126,0.08)] p-4">
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#B8CD7E]">Create Success</div>
                  <div className="mt-2 font-mono text-[12px] text-[#EAE4D8]">Job #{createdJobId} created</div>
                  <div className="mt-1 font-mono text-[10.5px] text-[rgba(234,228,216,0.68)]">Step 2 is prefilled below. Set Budget and Deposit Amount next.</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/job/${createdJobId}`} className="btn-bordered px-3 py-2 text-[9.5px]">OPEN JOB DETAIL</Link>
                    <button type="button" onClick={() => setFundForm((current) => ({ ...current, jobId: createdJobId }))} className="btn-primary px-3 py-2 text-[9.5px]">USE IN FUND STEP</button>
                  </div>
                </div>
              )}
            </div>

            <div className="aureo-panel p-4 md:p-6">
              <div className="aureo-mono-label mb-2">STEP 2 · BUDGET + DEPOSIT USDC</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Fund Settlement Vault</h2>
              <code className="mt-2 block font-mono text-[10.5px] text-[rgba(234,228,216,0.52)]">setBudget → approve USDC → fund</code>
              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.68)]">JOB ID</label>
                  <input
                    value={fundForm.jobId}
                    onChange={(e) => setFundForm((c) => ({ ...c, jobId: e.target.value }))}
                    placeholder="Job ID to budget and fund"
                    className="input-mono"
                  />
                  <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">Auto-filled after Create Job succeeds. You can also paste any existing job ID here.</div>
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.68)]">BUDGET AMOUNT</label>
                  <input
                    value={fundForm.budget}
                    onChange={(e) => setFundForm((c) => ({ ...c, budget: e.target.value }))}
                    placeholder="1"
                    className="input-mono"
                  />
                  <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">Writes the job budget in USDC. If you do not edit Deposit Amount manually, it mirrors this value.</div>
                </div>

                <div>
                  <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.68)]">DEPOSIT AMOUNT</label>
                  <input
                    value={fundForm.amount}
                    onChange={(e) => {
                      setDepositTouched(true);
                      setFundForm((c) => ({ ...c, amount: e.target.value }));
                    }}
                    placeholder="1"
                    className="input-mono"
                  />
                  <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">Approves USDC and deposits that amount into the Settlement Vault for this job.</div>
                </div>

                {selectedFundingJob && (
                  <div className="rounded-none border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.3)] px-4 py-3">
                    <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.52)]">Funding Preview</div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div className="font-mono text-[10.5px] text-[#EAE4D8]">Status {JOB_STATUS[selectedFundingJob.status]}</div>
                      <div className="font-mono text-[10.5px] text-[#EAE4D8]">Worker {shortenAddress(selectedFundingJob.worker)}</div>
                    </div>
                  </div>
                )}
              </div>
              <button onClick={handleFundJob} disabled={!isConnected || isCreating || isFunding} className="btn-primary mt-5">
                {isFunding ? 'FUNDING…' : 'SET BUDGET · FUND'}
              </button>
            </div>

            <div className="rounded-none border border-[rgba(255,255,255,0.08)] bg-[rgba(10,10,10,0.6)] p-5 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.68)]">
              {isConnected
                ? '✓ Wallet connected. Flow: Select Registered Agent → Create Job → Set Budget → Deposit USDC → later submit deliverable, evaluate, and mint Proof of Work.'
                : '⚠ Connect wallet to submit protocol writes.'}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
