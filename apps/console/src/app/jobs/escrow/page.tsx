'use client';

import Link from 'next/link';
import { useState, useEffect, type ReactNode } from 'react';
import { switchChain } from '@wagmi/core';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useArcWrite } from '@/hooks/useArcWrite';
import { buildCreateJobConfig } from '@arclayer/sdk';
import { config } from '@/lib/wagmi';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  'Smart Contract',
  'Frontend',
  'Backend',
  'DevOps',
  'Design',
  'Data Research',
  'Documentation',
  'Analysis',
  'Other',
] as const;

type Category = (typeof CATEGORIES)[number];
type SectionKey = 'overview' | 'scope' | 'budget' | 'review';

type FormState = {
  title: string;
  category: Category | '';
  description: string;
  deliverables: string;
  requirements: string;
  timeline: string;
  budgetMax: string;
  clientAddress: string;
  workerAgentId: string;
};

const emptyForm: FormState = {
  title: '',
  category: '',
  description: '',
  deliverables: '',
  requirements: '',
  timeline: '',
  budgetMax: '',
  clientAddress: '',
  workerAgentId: '',
};

const DRAFT_KEY = 'arclayer:escrow-work-order-draft';

/* ------------------------------------------------------------------ */
/*  Worker Agent type                                                  */
/* ------------------------------------------------------------------ */

type WorkerAgent = {
  agentId: string;
  name: string;
  controller: `0x${string}`;
  category?: string;
  reputationScore?: string;
};

/** Env fallback — always available so the form is never blocked. */
const envFallbackWorker: WorkerAgent | null =
  process.env.NEXT_PUBLIC_PROVIDER_AGENT_ID && process.env.NEXT_PUBLIC_WORKER_ADDR
    ? {
        agentId: process.env.NEXT_PUBLIC_PROVIDER_AGENT_ID,
        name: 'Default Worker Agent',
        controller: process.env.NEXT_PUBLIC_WORKER_ADDR as `0x${string}`,
      }
    : null;

/* ------------------------------------------------------------------ */
/*  Primitives                                                         */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: 'Complete' | 'Pending' }) {
  return (
    <span
      className={[
        'rounded-md border px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em]',
        status === 'Complete'
          ? 'border-[#B8CD7E]/20 bg-[#B8CD7E]/10 text-[#B8CD7E]'
          : 'border-[#F0B84A]/18 bg-[#F0B84A]/8 text-[#F0B84A]/75',
      ].join(' ')}
    >
      {status}
    </span>
  );
}

function FieldLabel({
  children,
  required,
}: {
  children: string;
  required?: boolean;
}) {
  return (
    <label className="mb-2 block text-[13px] font-semibold text-[#F4EFE5]">
      {children}
      {required ? <span className="ml-1 text-[#F0B84A]">*</span> : null}
    </label>
  );
}

const inputCls =
  'h-12 w-full rounded-lg border border-white/[0.06] bg-black/35 px-4 text-sm text-[#EAE4D8] outline-none transition placeholder:text-[#EAE4D8]/34 focus:border-[#C5A67C]/60';

const textareaCls =
  'w-full resize-none rounded-lg border border-white/[0.06] bg-black/35 px-4 py-3 text-sm leading-6 text-[#EAE4D8] outline-none transition placeholder:text-[#EAE4D8]/34 focus:border-[#C5A67C]/60';

/* ------------------------------------------------------------------ */
/*  Accordion Section Card                                             */
/* ------------------------------------------------------------------ */

function SectionCard({
  number,
  title,
  subtitle,
  status,
  open,
  onToggle,
  children,
}: {
  number: number;
  title: string;
  subtitle: string;
  status: 'Complete' | 'Pending';
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#EAE4D8]/[0.06] shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      {/* Header — always visible, clickable */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-5 px-7 py-5 text-left"
      >
        <div className="flex items-start gap-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#C5A67C]/45 bg-black/35 font-mono text-sm text-[#F0B84A] shadow-[0_0_24px_rgba(240,184,74,0.08)]">
            {number}
          </div>
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#F4EFE5]">
              {title}
            </h2>
            <p className="mt-1 text-sm leading-5 text-[#EAE4D8]/66">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center shrink-0">
          <span className="text-2xl text-[#EAE4D8]/75 select-none">
            {open ? '⌃' : '⌄'}
          </span>
        </div>
      </button>

      {/* Body — collapsible */}
      {open ? (
        <div className="border-t border-white/[0.04] px-7 pb-7 pt-6">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timelineToSeconds(timeline: string): number {
  switch (timeline) {
    case '24 hours': return 24 * 60 * 60;
    case '3 days': return 3 * 24 * 60 * 60;
    case '7 days': return 7 * 24 * 60 * 60;
    case '14 days': return 14 * 24 * 60 * 60;
    case '30 days': return 30 * 24 * 60 * 60;
    default: return 7 * 24 * 60 * 60;
  }
}

function usdcToAtomic(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) return '0';
  return String(Math.round(num * 1e6));
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function EscrowWorkOrderPage() {
  const { address, isConnected } = useArcWallet();
  const { writeContractAsync } = useArcWrite();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    overview: true,
    scope: true,
    budget: false,
    review: false,
  });
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [txState, setTxState] = useState('');
  const [result, setResult] = useState<{
    localJobId: string;
    erc8183JobId: string;
    createTxHash: string;
    budgetAtomic: string;
  } | null>(null);
  const [workerAgents, setWorkerAgents] = useState<WorkerAgent[]>([]);
  const [workersLoading, setWorkersLoading] = useState(false);

  /* ---- Hydrate from draft on mount ---- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<FormState>;
        setForm((prev) => ({ ...prev, ...saved }));
      }
    } catch {
      /* corrupted draft — ignore */
    }
  }, []);

  /* ---- Load worker agents filtered by selected category ---- */
  useEffect(() => {
    if (!form.category) {
      setWorkerAgents([]);
      return;
    }

    let alive = true;

    async function load() {
      setWorkersLoading(true);
      try {
        const categoryParam = encodeURIComponent(form.category);
        const res = await fetch(`/api/a2a/agents/by-category?category=${categoryParam}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        if (!json.ok || !Array.isArray(json.agents)) throw new Error('bad response');

        const agents: WorkerAgent[] = json.agents
          .filter((a: { controller?: string | null }) => a.controller && /^0x[0-9a-fA-F]{40}$/.test(a.controller))
          .map((a: { agentId?: string | number | null; id?: string | number | null; name?: string | null; controller?: string | null; roles?: Array<{ category?: string }> | null }) => ({
            agentId: String(a.agentId ?? a.id ?? ''),
            name: a.name || `Agent ${String(a.agentId ?? a.id ?? '').slice(0, 8)}`,
            controller: a.controller as `0x${string}`,
            category: a.roles?.[0]?.category ?? undefined,
          }));

        if (alive) {
          setWorkerAgents(agents);
        }
      } catch {
        if (alive && envFallbackWorker) {
          setWorkerAgents([envFallbackWorker]);
        }
      } finally {
        if (alive) setWorkersLoading(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [form.category]);

  /* ---- Derived completion flags ---- */
  const overviewComplete = Boolean(
    form.title.trim() &&
      form.category &&
      form.description.trim() &&
      form.workerAgentId,
  );
  const scopeComplete = Boolean(
    form.deliverables.trim() && form.requirements.trim() && form.timeline,
  );
  const budgetComplete = Boolean(form.budgetMax);
  const canCreate = overviewComplete && scopeComplete && budgetComplete;

  /* ---- Handlers ---- */
  function toggleSection(key: SectionKey) {
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setError('');
    setSuccess('');
    setForm((s) => ({ ...s, [key]: value }));
  }

  function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    setError('');
    setSuccess('Draft saved locally.');
  }

  async function createJob() {
    if (!canCreate) {
      setSuccess('');
      setError('Complete Overview, Scope, and Budget before creating the job.');
      return;
    }

    if (!isConnected || !address) {
      setError('Connect your wallet first.');
      return;
    }

    // Look up selected worker agent
    const selectedWorker = workerAgents.find(
      (agent) => agent.agentId === form.workerAgentId,
    );

    if (!selectedWorker) {
      setError('Select a worker agent first.');
      return;
    }

    const providerAgentId = selectedWorker.agentId;
    const providerAddress = selectedWorker.controller;
    const evaluatorAddress = address as `0x${string}`;
    try {
      setCreating(true);
      setError('');
      setSuccess('');
      setResult(null);

      // Build payload
      const expiredAtUnix = String(Math.floor(Date.now() / 1000) + timelineToSeconds(form.timeline));
      const budgetAtomic = usdcToAtomic(form.budgetMax);

      const inputPayload = {
        title: form.title,
        category: form.category,
        description: form.description,
        deliverables: form.deliverables,
        requirements: form.requirements,
      };

      // Step 1: Create local job via server-side wrapper
      setTxState('Creating local ERC-8183 job…');
      const createRes = await fetch('/api/jobs/escrow/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerAgentId: 'console-user', // placeholder — will be replaced with real agent ID
          clientAddress: address,
          evaluatorAddress,
          providerAgentId,
          providerAddress,
          expiredAtUnix,
          budgetAtomic,
          description: form.description,
          inputPayload,
        }),
      });

      if (!createRes.ok) {
        const errBody = await createRes.json().catch(() => ({}));
        throw new Error(errBody.message || `Server error ${createRes.status}`);
      }

      const createData = await createRes.json();
      if (!createData.ok || !createData.localJobId || !createData.tx) {
        throw new Error(createData.message || 'Failed to create local job.');
      }

      const { localJobId } = createData;

      // Step 2: Ensure wallet is on Arc Testnet, then sign
      setTxState('Switching to Arc Testnet…');
      await switchChain(config, { chainId: 5042002 });

      setTxState('Waiting for wallet signature…');
      const createHash = await writeContractAsync(
        buildCreateJobConfig(
          providerAddress,
          evaluatorAddress,
          BigInt(expiredAtUnix),
          form.description,
          '0x0000000000000000000000000000000000000000' as `0x${string}`,
        ),
      );

      // Step 3: Confirm with backend (writeContractAsync already awaited receipt)
      setTxState('Confirming JobCreated event…');
      const confirmRes = await fetch('/api/jobs/escrow/created', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localJobId, createTxHash: createHash }),
      });

      if (!confirmRes.ok) {
        const confirmErr = await confirmRes.json().catch(() => ({}));
        throw new Error(confirmErr.message || `Confirm error ${confirmRes.status}`);
      }

      const confirmData = await confirmRes.json();
      if (!confirmData.ok || !confirmData.erc8183JobId) {
        throw new Error(confirmData.message || 'Failed to confirm JobCreated event.');
      }

      // Success!
      setResult({
        localJobId,
        erc8183JobId: confirmData.erc8183JobId,
        createTxHash: createHash,
        budgetAtomic,
      });
      localStorage.removeItem(DRAFT_KEY);
      setTxState('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Job creation failed.');
      setTxState('');
    } finally {
      setCreating(false);
    }
  }

  /* ---- Render ---- */
  const selectedWorker = workerAgents.find(
    (a) => a.agentId === form.workerAgentId,
  );

  const reviewRows = [
    ['Job Title', form.title],
    ['Category', form.category],
    ['Deadline', form.timeline],
    ['Escrow Budget', form.budgetMax ? `${form.budgetMax} USDC` : ''],
    ['Settlement', 'ERC-8183 Escrow'],
    ['Token', 'USDC'],
    ['Network', 'Arc Testnet'],
    ['Client Wallet', address || form.clientAddress || 'Not connected'],
    ['Evaluator Wallet', 'Same as client'],
    ['Worker Agent', selectedWorker?.name ?? 'Not selected'],
  ] as const;

  const reviewBlocks = [
    ['Description', form.description],
    ['Deliverables', form.deliverables],
    ['Requirements', form.requirements],
  ] as const;

  return (
    <div className="min-h-screen overflow-hidden bg-[#050505] text-[#EAE4D8]">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(197,166,124,0.20),transparent_36%),radial-gradient(circle_at_22%_15%,rgba(255,255,255,0.045),transparent_25%),linear-gradient(180deg,#07090C_0%,#050505_55%,#020203_100%)]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <main className="relative mx-auto w-full max-w-[1440px] px-6 pb-28 pt-7 md:px-12">
        {/* Back link */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-[#F0B84A] transition hover:text-[#FFD084]"
        >
          ← Back to Dashboard
        </Link>

        {/* Header */}
        <header className="mt-7">
          <h1 className="text-[42px] font-semibold tracking-[-0.04em] text-[#F4EFE5] md:text-[58px]">
            Create Manual Job
          </h1>
          <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[#EAE4D8]/66">
            Provide the details of the work you need done. Fill in each section
            below — you can always come back and edit later.
          </p>
          <div className="mt-6 px-1 py-1 text-sm text-[#EAE4D8]/70">
            ⓘ Start simple. You can always edit or add more details after your
            job is created.
          </div>
        </header>

        {/* Accordion sections */}
        <div className="mt-6">
        <div className="space-y-3">
          {/* 1 — Overview */}
          <SectionCard
            number={1}
            title="Overview"
            subtitle="Add a short title, choose a category, and describe the work."
            status={overviewComplete ? 'Complete' : 'Pending'}
            open={openSections.overview}
            onToggle={() => toggleSection('overview')}
          >
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <FieldLabel required>Job Title</FieldLabel>
                <input
                  value={form.title}
                  onChange={(e) => update('title', e.target.value)}
                  placeholder="e.g. Smart Contract Security Audit"
                  className={inputCls}
                />
                <p className="mt-2 text-xs text-[#EAE4D8]/53">
                  A clear title helps attract the right agents.
                </p>
              </div>

              <div>
                <FieldLabel required>Category</FieldLabel>
                <select
                  value={form.category}
                  onChange={(e) => {
                    const nextCategory = e.target.value as Category | '';
                    setForm((s) => ({
                      ...s,
                      category: nextCategory,
                      workerAgentId: '',
                    }));
                    setError('');
                    setSuccess('');
                  }}
                  className={inputCls}
                >
                  <option value="">Select a category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-[#EAE4D8]/53">
                  Choose the category that best fits your job.
                </p>
              </div>

              <div className="lg:col-span-2">
                <FieldLabel required>Description</FieldLabel>
                <textarea
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  rows={5}
                  maxLength={2000}
                  placeholder="Describe the work to be done…"
                  className={textareaCls}
                />
                <p className="mt-2 text-xs text-[#EAE4D8]/53">
                  Provide a detailed description. Agents use this to decide
                  whether to apply.
                </p>
              </div>

              <div className="lg:col-span-2">
                <FieldLabel>Client Wallet</FieldLabel>
                <input
                  value={address || form.clientAddress || 'Not connected'}
                  readOnly
                  className={`${inputCls} cursor-not-allowed opacity-80`}
                />
                <p className="mt-2 text-xs text-[#EAE4D8]/62">
                  This wallet will be used as the ERC-8183 client address.
                </p>
              </div>

              <div className="lg:col-span-2">
                <FieldLabel required>Worker Agent</FieldLabel>
                <select
                  value={form.workerAgentId}
                  onChange={(e) => update('workerAgentId', e.target.value)}
                  className={inputCls}
                  disabled={!form.category || workersLoading}
                >
                  <option value="">
                    {!form.category
                      ? 'Select a category first'
                      : workersLoading
                        ? 'Loading worker agents…'
                        : 'Select a worker agent'}
                  </option>
                  {workerAgents.map((agent) => (
                    <option key={agent.agentId} value={agent.agentId}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-[#EAE4D8]/53">
                  Selected agent to receive this ERC-8183 job.
                </p>
              </div>
            </div>
          </SectionCard>

          {/* 2 — Scope */}
          <SectionCard
            number={2}
            title="Scope"
            subtitle="Define deliverables, requirements, and timeline."
            status={scopeComplete ? 'Complete' : 'Pending'}
            open={openSections.scope}
            onToggle={() => toggleSection('scope')}
          >
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <FieldLabel required>Deliverables</FieldLabel>
                <textarea
                  value={form.deliverables}
                  onChange={(e) => update('deliverables', e.target.value)}
                  rows={5}
                  maxLength={2000}
                  placeholder="List the key deliverables you expect…"
                  className={textareaCls}
                />
                <p className="mt-2 text-xs text-[#EAE4D8]/53">
                  What the agent should hand over when the job is done.
                </p>
              </div>

              <div>
                <FieldLabel required>Requirements</FieldLabel>
                <textarea
                  value={form.requirements}
                  onChange={(e) => update('requirements', e.target.value)}
                  rows={5}
                  maxLength={1500}
                  placeholder="requirements for this job…"
                  className={textareaCls}
                />
                <p className="mt-2 text-xs text-[#EAE4D8]/53">
                  Required criteria for completion job.
                </p>
              </div>

              <div>
                <FieldLabel required>Timeline</FieldLabel>
                <select
                  value={form.timeline}
                  onChange={(e) => update('timeline', e.target.value)}
                  className={inputCls}
                >
                  <option value="">Select deadline</option>
                  <option value="24 hours">24 hours</option>
                  <option value="3 days">3 days</option>
                  <option value="7 days">7 days</option>
                  <option value="14 days">14 days</option>
                  <option value="30 days">30 days</option>
                </select>
                <p className="mt-2 text-xs text-[#EAE4D8]/53">
                  Deadline for job completion.
                </p>
              </div>

              <div className="flex items-end">
                <div className="rounded-lg border border-[#F0B84A]/20 bg-[#F0B84A]/8 px-4 py-3 text-sm text-[#EAE4D8]/72">
                  ⓘ Tip: A realistic timeline helps you receive better proposals.
                </div>
              </div>
            </div>
          </SectionCard>

          {/* 3 — Budget */}
          <SectionCard
            number={3}
            title="Budget"
            subtitle="Set the escrow budget for this job."
            status={budgetComplete ? 'Complete' : 'Pending'}
            open={openSections.budget}
            onToggle={() => toggleSection('budget')}
          >
            <div>
              <FieldLabel required>Escrow Budget</FieldLabel>
              <div className="relative">
                <input
                  value={form.budgetMax}
                  onChange={(e) => update('budgetMax', e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 100"
                  className={`${inputCls} pr-20`}
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-[#EAE4D8]/62">
                  USDC
                </span>
              </div>
              <p className="mt-2 text-xs text-[#EAE4D8]/62">
                Budget amount to use after job creation.
              </p>
            </div>
          </SectionCard>

          {/* 4 — Review & Create */}
          <SectionCard
            number={4}
            title="Review & Create"
            subtitle="Confirm the ERC-8183 escrow job before creating the draft."
            status={
              overviewComplete && scopeComplete && budgetComplete
                ? 'Complete'
                : 'Pending'
            }
            open={openSections.review}
            onToggle={() => toggleSection('review')}
          >
            <div className="rounded-lg border border-white/[0.04] bg-black/25 p-4">
              {reviewRows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-6 border-b border-white/[0.04] py-3 last:border-b-0"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/38">
                    {label}
                  </span>
                  <span className="text-right text-sm font-semibold text-[#F4EFE5]">
                    {value || 'Not set'}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-4">
              {reviewBlocks.map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-white/[0.04] bg-black/25 p-4"
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/38">
                    {label}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#F4EFE5]">
                    {value || 'Not set'}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-lg border border-[#F0B84A]/20 bg-[#F0B84A]/8 px-4 py-3 text-sm text-[#EAE4D8]/72">
              This preview will create a local ERC-8183 escrow draft before wallet signing.
            </div>
          </SectionCard>

          {/* Feedback banners */}
          {creating && txState ? (
            <div className="rounded-lg border border-[#F0B84A]/25 bg-[#F0B84A]/10 px-5 py-3 text-sm text-[#F0B84A]">
              {txState}
            </div>
          ) : null}
          {success ? (
            <div className="rounded-lg border border-[#B8CD7E]/25 bg-[#B8CD7E]/10 px-5 py-3 text-sm text-[#B8CD7E]">
              {success}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-red-400/25 bg-red-400/10 px-5 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          {/* Success summary card */}
          {result ? (
            <div className="rounded-xl border border-[#B8CD7E]/25 bg-[#B8CD7E]/5 p-6">
              <h3 className="text-lg font-semibold text-[#B8CD7E]">Job Created Successfully</h3>
              <div className="mt-4 space-y-3">
                {([
                  ['Local Job ID', result.localJobId],
                  ['ERC-8183 Job ID', result.erc8183JobId],
                  ['Status', 'Open'],
                  ['Escrow Budget', `${form.budgetMax} USDC`],
                  ['Create Tx Hash', result.createTxHash],
                  ['Settlement', 'ERC-8183 Escrow'],
                  ['Network', 'Arc Testnet'],
                  ['Token', 'USDC'],
                ] as const).map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-6">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/38">
                      {label}
                    </span>
                    <span className="max-w-[60%] truncate text-right text-sm font-mono text-[#F4EFE5]">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/profile?tab=jobs"
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-[#B8CD7E]/35 bg-[#B8CD7E]/10 px-6 text-sm font-semibold text-[#B8CD7E] transition hover:bg-[#B8CD7E]/20"
                >
                  View in Profile →
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setForm(emptyForm);
                    setSuccess('');
                    setError('');
                  }}
                  className="h-11 rounded-lg border border-white/[0.06] bg-black/35 px-6 text-sm font-semibold text-[#EAE4D8] transition hover:bg-white/[0.04]"
                >
                  Create Another Job
                </button>
              </div>
            </div>
          ) : null}
        </div>
        </div>

        {/* Sticky bottom action bar */}
        <div className="sticky bottom-0 z-20 mt-6 flex flex-col gap-4 rounded-t-xl border-t border-white/[0.04] bg-[#050505]/92 px-7 py-5 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-[#EAE4D8]/55">
            You can save a draft and continue later.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={saveDraft}
              className="h-12 rounded-lg border border-[#C5A67C]/35 bg-black/35 px-9 text-sm font-semibold text-[#F0B84A] transition hover:border-[#F0B84A]/70 hover:bg-[#F0B84A]/8"
            >
              Save Draft
            </button>
            <button
              type="button"
              onClick={createJob}
              disabled={creating || !canCreate || !isConnected}
              className="h-12 rounded-lg border border-[#F0B84A]/55 bg-[#F0B84A] px-10 text-sm font-semibold text-black shadow-[0_0_34px_rgba(240,184,74,0.18)] transition hover:bg-[#FFD084] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create Job →'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}


