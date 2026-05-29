'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

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

type FormState = {
  title: string;
  category: Category | '';
  description: string;
  deliverables: string;
  requirements: string;
  timeline: string;
  budgetMin: string;
  budgetMax: string;
};

const initialForm: FormState = {
  title: 'Smart Contract Security Audit',
  category: 'Smart Contract',
  description:
    'We need a comprehensive security audit of our Ethereum smart contract system.\nThe audit should include vulnerability assessment, code review, and recommendations.',
  deliverables:
    '• Security audit report (PDF)\n• Vulnerability assessment\n• Code review summary\n• Recommendations\n• Risk rating and severity',
  requirements:
    '• Experience with Solidity and Ethereum\n• Prior smart contract audit experience\n• Use of industry-standard security tools\n• Clear and actionable reporting',
  timeline: '7 days',
  budgetMin: '',
  budgetMax: '',
};

function StatusBadge({ status }: { status: 'Complete' | 'Pending' }) {
  return (
    <span
      className={[
        'rounded-md border px-3 py-1 font-mono text-[10px] font-medium',
        status === 'Complete'
          ? 'border-[#B8CD7E]/20 bg-[#B8CD7E]/10 text-[#B8CD7E]'
          : 'border-[#F0B84A]/18 bg-[#F0B84A]/8 text-[#F0B84A]/75',
      ].join(' ')}
    >
      {status}
    </span>
  );
}

function SectionShell({
  number,
  title,
  subtitle,
  status,
  open,
  children,
}: {
  number: number;
  title: string;
  subtitle: string;
  status: 'Complete' | 'Pending';
  open: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-[#080A0D]/78 shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-5 px-7 py-5">
        <div className="flex items-start gap-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#C5A67C]/45 bg-black/35 font-mono text-sm text-[#F0B84A] shadow-[0_0_24px_rgba(240,184,74,0.08)]">
            {number}
          </div>

          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#F4EFE5]">
              {title}
            </h2>
            <p className="mt-1 text-sm leading-5 text-[#EAE4D8]/55">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <StatusBadge status={status} />
          <span className="text-lg text-[#EAE4D8]/75">{open ? '⌃' : '⌄'}</span>
        </div>
      </div>

      {open ? (
        <div className="border-t border-white/8 px-7 pb-7 pt-6">{children}</div>
      ) : null}
    </section>
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

function inputClass() {
  return 'h-12 w-full rounded-lg border border-white/10 bg-black/35 px-4 text-sm text-[#EAE4D8] outline-none transition placeholder:text-[#EAE4D8]/34 focus:border-[#C5A67C]/60';
}

function textareaClass() {
  return 'w-full resize-none rounded-lg border border-white/10 bg-black/35 px-4 py-3 text-sm leading-6 text-[#EAE4D8] outline-none transition placeholder:text-[#EAE4D8]/34 focus:border-[#C5A67C]/60';
}

export default function EscrowWorkOrderPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialForm);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const overviewComplete = Boolean(
    form.title.trim() && form.category && form.description.trim(),
  );
  const scopeComplete = Boolean(
    form.deliverables.trim() && form.requirements.trim() && form.timeline,
  );
  const budgetComplete = Boolean(form.budgetMin || form.budgetMax);

  const canCreate = overviewComplete && scopeComplete;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setError('');
    setForm((current) => ({ ...current, [key]: value }));
  }

  function saveDraft() {
    localStorage.setItem('arclayer:escrow-work-order-draft', JSON.stringify(form));
  }

  async function createJob() {
    if (!canCreate) {
      setError('Complete Overview and Scope before creating the job.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/jobs/escrow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const payload = (await res.json()) as {
        ok?: boolean;
        jobId?: string;
        error?: string;
        message?: string;
      };

      if (!res.ok || !payload.ok) {
        throw new Error(payload.message || payload.error || 'Failed to create job.');
      }

      localStorage.removeItem('arclayer:escrow-work-order-draft');

      if (payload.jobId) {
        router.push(`/job/${payload.jobId}`);
        return;
      }

      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create job.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen overflow-hidden bg-[#050607] text-[#EAE4D8]">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_0%,rgba(197,166,124,0.20),transparent_36%),radial-gradient(circle_at_22%_15%,rgba(255,255,255,0.045),transparent_25%),linear-gradient(180deg,#07090C_0%,#050607_55%,#020203_100%)]" />
        <div className="absolute left-[-10%] top-[118px] h-[420px] w-[120%] rounded-[100%] border-t border-[#C5A67C]/18 bg-[radial-gradient(ellipse_at_center,rgba(197,166,124,0.10),transparent_65%)]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <main className="relative mx-auto w-full max-w-[1440px] px-6 pb-24 pt-7 md:px-12">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-[#F0B84A] transition hover:text-[#FFD084]"
        >
          ← Back to Dashboard
        </Link>

        <header className="mt-7">
          <h1 className="text-[42px] font-semibold tracking-[-0.04em] text-[#F4EFE5] md:text-[58px]">
            Create Manual Job
          </h1>

          <p className="mt-3 max-w-4xl text-[15px] leading-7 text-[#EAE4D8]/66">
            Provide the details of the work you need done. Start simple — you can edit
            everything later.
          </p>

          <div className="mt-6 rounded-lg border border-[#C5A67C]/25 bg-[#C5A67C]/8 px-5 py-3 text-sm text-[#EAE4D8]/76">
            ⓘ Start simple. You can always edit or add more details after your job is created.
          </div>
        </header>

        <div className="mt-5 space-y-3">
          <SectionShell
            number={1}
            title="Overview"
            subtitle="Add a short title, choose a category, and describe the work."
            status={overviewComplete ? 'Complete' : 'Pending'}
            open
          >
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <FieldLabel>Job Title</FieldLabel>
                <input
                  value={form.title}
                  onChange={(event) => update('title', event.target.value)}
                  placeholder="e.g. Smart Contract Security Audit"
                  className={inputClass()}
                />
                <p className="mt-2 text-xs text-[#EAE4D8]/45">
                  A clear title helps attract the right agents.
                </p>
              </div>

              <div>
                <FieldLabel>Category</FieldLabel>
                <select
                  value={form.category}
                  onChange={(event) => update('category', event.target.value as Category)}
                  className={inputClass()}
                >
                  <option value="">Select a category</option>
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-[#EAE4D8]/45">
                  Choose the category that best fits your job.
                </p>
              </div>

              <div>
                <FieldLabel>Description</FieldLabel>
                <textarea
                  value={form.description}
                  onChange={(event) => update('description', event.target.value)}
                  rows={6}
                  maxLength={2000}
                  placeholder="Describe the work to be done..."
                  className={textareaClass()}
                />
                <p className="mt-2 text-xs text-[#EAE4D8]/45">
                  Provide a detailed description of the work to be done.
                </p>
              </div>

              <div>
                <FieldLabel>Deliverables</FieldLabel>
                <textarea
                  value={form.deliverables}
                  onChange={(event) => update('deliverables', event.target.value)}
                  rows={6}
                  maxLength={2000}
                  placeholder="List the key deliverables you expect from the agent..."
                  className={textareaClass()}
                />
                <p className="mt-2 text-xs text-[#EAE4D8]/45">
                  List the key deliverables you expect from the agent.
                </p>
              </div>
            </div>
          </SectionShell>

          <SectionShell
            number={2}
            title="Scope"
            subtitle="Define the requirements and timeline for your job."
            status={scopeComplete ? 'Complete' : 'Pending'}
            open
          >
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <FieldLabel>Requirements</FieldLabel>
                <textarea
                  value={form.requirements}
                  onChange={(event) => update('requirements', event.target.value)}
                  rows={5}
                  maxLength={1500}
                  placeholder="List the skills, experience, or tools required..."
                  className={textareaClass()}
                />
                <p className="mt-2 text-xs text-[#EAE4D8]/45">
                  List the skills, experience, or tools required.
                </p>
              </div>

              <div>
                <FieldLabel>Timeline</FieldLabel>
                <select
                  value={form.timeline}
                  onChange={(event) => update('timeline', event.target.value)}
                  className={inputClass()}
                >
                  <option value="">Select timeline</option>
                  <option value="24 hours">24 hours</option>
                  <option value="3 days">3 days</option>
                  <option value="7 days">7 days</option>
                  <option value="14 days">14 days</option>
                  <option value="30 days">30 days</option>
                </select>
                <p className="mt-2 text-xs text-[#EAE4D8]/45">
                  Select your desired timeline for completion.
                </p>

                <div className="mt-5 rounded-lg border border-[#F0B84A]/20 bg-[#F0B84A]/8 px-4 py-3 text-sm text-[#EAE4D8]/72">
                  ⓘ Tip: A realistic timeline helps you receive better proposals.
                </div>
              </div>
            </div>
          </SectionShell>

          <SectionShell
            number={3}
            title="Budget"
            subtitle="Set your budget range or exact amount."
            status={budgetComplete ? 'Complete' : 'Pending'}
            open={false}
          />

          <SectionShell
            number={4}
            title="Final Review"
            subtitle="Review your job details before posting."
            status={overviewComplete && scopeComplete && budgetComplete ? 'Complete' : 'Pending'}
            open={false}
          />

          {error ? (
            <div className="rounded-lg border border-red-400/25 bg-red-400/10 px-5 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <div className="sticky bottom-0 z-20 mt-4 flex flex-col gap-4 rounded-t-xl border-t border-white/8 bg-[#050607]/92 px-7 py-5 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
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
                disabled={isSubmitting}
                className="h-12 rounded-lg border border-[#F0B84A]/55 bg-[#F0B84A] px-10 text-sm font-semibold text-black shadow-[0_0_34px_rgba(240,184,74,0.18)] transition hover:bg-[#FFD084] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Creating...' : 'Create Job →'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
