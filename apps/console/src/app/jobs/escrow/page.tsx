'use client';

import Link from 'next/link';
import { useState, useEffect, type ReactNode } from 'react';

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
  budgetMin: string;
  budgetMax: string;
  clientAddress: string;
};

const emptyForm: FormState = {
  title: '',
  category: '',
  description: '',
  deliverables: '',
  requirements: '',
  timeline: '',
  budgetMin: '',
  budgetMax: '',
  clientAddress: '',
};

const DRAFT_KEY = 'arclayer:escrow-work-order-draft';
const PREVIEW_KEY = 'arclayer:escrow-work-order-preview';

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
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function EscrowWorkOrderPage() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    overview: true,
    scope: true,
    budget: false,
    review: false,
  });
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

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

  /* ---- Derived completion flags ---- */
  const overviewComplete = Boolean(
    form.title.trim() && form.category && form.description.trim(),
  );
  const scopeComplete = Boolean(
    form.deliverables.trim() && form.requirements.trim() && form.timeline,
  );
  const budgetComplete = Boolean(form.budgetMin || form.budgetMax);
  const canCreate = overviewComplete && scopeComplete;

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

  function createJob() {
    if (!canCreate) {
      setSuccess('');
      setError('Complete Overview and Scope before creating the job.');
      return;
    }

    const localJob = {
      id: `local_${Date.now()}`,
      type: 'escrow_work_order_draft',
      paymentRail: 'erc8183_escrow',
      ...form,
      status: 'local_draft',
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem(PREVIEW_KEY, JSON.stringify(localJob));
    localStorage.removeItem(DRAFT_KEY);
    setError('');
    setSuccess('Job draft created locally. Backend wiring will be added later.');
  }

  /* ---- Render ---- */
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
                <p className="mt-2 text-xs text-[#EAE4D8]/57">
                  A clear title helps attract the right agents.
                </p>
              </div>

              <div>
                <FieldLabel required>Category</FieldLabel>
                <select
                  value={form.category}
                  onChange={(e) =>
                    update('category', e.target.value as Category)
                  }
                  className={inputCls}
                >
                  <option value="">Select a category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-[#EAE4D8]/57">
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
                <p className="mt-2 text-xs text-[#EAE4D8]/57">
                  Provide a detailed description. Agents use this to decide
                  whether to apply.
                </p>
              </div>

              <div className="lg:col-span-2">
                <FieldLabel>Client Wallet</FieldLabel>
                <input
                  value={form.clientAddress || 'Not connected'}
                  readOnly
                  className={`${inputCls} cursor-not-allowed opacity-80`}
                />
                <p className="mt-2 text-xs text-[#EAE4D8]/62">
                  This wallet will be used as the ERC-8183 client address.
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
                <p className="mt-2 text-xs text-[#EAE4D8]/57">
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
                <p className="mt-2 text-xs text-[#EAE4D8]/57">
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
                  <option value="">Select timeline</option>
                  <option value="24 hours">24 hours</option>
                  <option value="3 days">3 days</option>
                  <option value="7 days">7 days</option>
                  <option value="14 days">14 days</option>
                  <option value="30 days">30 days</option>
                </select>
                <p className="mt-2 text-xs text-[#EAE4D8]/57">
                  Select your desired timeline for completion.
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
            subtitle="Set your budget range or exact amount."
            status={budgetComplete ? 'Complete' : 'Pending'}
            open={openSections.budget}
            onToggle={() => toggleSection('budget')}
          >
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <FieldLabel>Minimum Budget</FieldLabel>
                <div className="relative">
                  <input
                    value={form.budgetMin}
                    onChange={(e) => update('budgetMin', e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 100"
                    className={`${inputCls} pr-20`}
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-[#EAE4D8]/57">
                    USDC
                  </span>
                </div>
              </div>

              <div>
                <FieldLabel>Maximum Budget</FieldLabel>
                <div className="relative">
                  <input
                    value={form.budgetMax}
                    onChange={(e) => update('budgetMax', e.target.value)}
                    inputMode="decimal"
                    placeholder="e.g. 250"
                    className={`${inputCls} pr-20`}
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-[#EAE4D8]/57">
                    USDC
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* 4 — Final Review */}
          <SectionCard
            number={4}
            title="Final Review"
            subtitle="Review your job details before posting."
            status={
              overviewComplete && scopeComplete && budgetComplete
                ? 'Complete'
                : 'Pending'
            }
            open={openSections.review}
            onToggle={() => toggleSection('review')}
          >
            <div className="grid gap-4 md:grid-cols-4">
              <ReviewCard label="Job Title" value={form.title} />
              <ReviewCard label="Category" value={form.category} />
              <ReviewCard label="Timeline" value={form.timeline} />
              <ReviewCard
                label="Budget"
                value={
                  form.budgetMin || form.budgetMax
                    ? `${form.budgetMin || '0'} – ${form.budgetMax || '∞'} USDC`
                    : ''
                }
              />
            </div>

            <div className="mt-5 rounded-lg border border-[#F0B84A]/20 bg-[#F0B84A]/8 px-4 py-3 text-sm text-[#EAE4D8]/72">
              This is a local preview only. Backend, indexer, and ERC-8183
              wiring will be added later.
            </div>
          </SectionCard>

          {/* Feedback banners */}
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
              className="h-12 rounded-lg border border-[#F0B84A]/55 bg-[#F0B84A] px-10 text-sm font-semibold text-black shadow-[0_0_34px_rgba(240,184,74,0.18)] transition hover:bg-[#FFD084]"
            >
              Create Job →
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Review summary card                                                */
/* ------------------------------------------------------------------ */

function ReviewCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.04] bg-black/25 px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/38">
        {label}
      </p>
      <p className="mt-2 truncate text-sm font-semibold text-[#F4EFE5]">
        {value || 'Not set'}
      </p>
    </div>
  );
}
