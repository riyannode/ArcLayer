'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  Check,
  ClipboardList,
  FileJson,
  KeyRound,
  Link2,
  Shield,
  Wallet,
  Workflow,
} from 'lucide-react';

type EscrowMode = 'provider' | 'client' | 'evaluator' | 'suite';
type RoleId = 'client' | 'provider' | 'evaluator';

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

type RoleConfig = {
  id: RoleId;
  title: string;
  label: string;
  description: string;
  defaultSlug: string;
  botRole: string;
  endpointPath: string;
  mode: 'buyer' | 'seller' | 'dual';
  scopes: string[];
  capabilities: string[];
  accepts: string[];
};

type FormState = {
  mode: EscrowMode;
  agentName: string;
  runtimeBaseUrl: string;
  clientWallet: string;
  providerWallet: string;
  evaluatorWallet: string;
  payoutWallet: string;
  workTitle: string;
  category: Category | '';
  description: string;
  deliverables: string;
  requirements: string;
  timeline: string;
  defaultBudgetAtomic: string;
  minEvalScore: string;
  maxOpenJobs: string;
  maxActiveJobs: string;
  capabilities: string;
  proofTypes: string[];
  autonomousTx: boolean;
  llmEvaluation: boolean;
  confirm: boolean;
};

const ROLE_CONFIG: Record<RoleId, RoleConfig> = {
  client: {
    id: 'client',
    title: 'Autonomous Client Bot',
    label: 'Client Bot',
    description:
      'Creates and funds escrow jobs automatically. Manual clients should use Jobs → Create Job.',
    defaultSlug: 'erc8183-client',
    botRole: 'client',
    endpointPath: 'client-bot/index.js',
    mode: 'buyer',
    scopes: ['erc8183:create', 'erc8183:confirm', 'erc8183:tx'],
    capabilities: ['create_job', 'fund_escrow', 'approve_usdc', 'onchain_tx'],
    accepts: ['create', 'fund_escrow', 'confirm'],
  },
  provider: {
    id: 'provider',
    title: 'Worker / Provider Runtime',
    label: 'Worker',
    description: 'Receives matching escrow work orders, performs the work, and submits proof.',
    defaultSlug: 'erc8183-provider',
    botRole: 'provider',
    endpointPath: 'provider-bot/index.js',
    mode: 'seller',
    scopes: ['erc8183:claim', 'erc8183:running', 'erc8183:submit', 'erc8183:tx'],
    capabilities: ['claim_job', 'submit_work', 'onchain_tx'],
    accepts: ['claim', 'running', 'submit_work', 'submit-proof'],
  },
  evaluator: {
    id: 'evaluator',
    title: 'Evaluator Runtime',
    label: 'Evaluator',
    description: 'Reviews submitted work and completes escrow when requirements are satisfied.',
    defaultSlug: 'erc8183-evaluator',
    botRole: 'evaluator',
    endpointPath: 'evaluator-bot/index.js',
    mode: 'dual',
    scopes: ['erc8183:complete', 'erc8183:tx'],
    capabilities: ['evaluate', 'settle', 'complete_job', 'onchain_tx'],
    accepts: ['evaluate', 'complete', 'settle'],
  },
};

const TIMELINES = ['24 hours', '3 days', '7 days', '14 days', '30 days'];
const PROOF_TYPES = ['signed_result', 'url', 'workproof_nft'];

const DEFAULT_FORM: FormState = {
  mode: 'provider',
  agentName: '',
  runtimeBaseUrl: '',
  clientWallet: '',
  providerWallet: '',
  evaluatorWallet: '',
  payoutWallet: '',
  workTitle: '',
  category: '',
  description: '',
  deliverables: '',
  requirements: '',
  timeline: '7 days',
  defaultBudgetAtomic: '1000',
  minEvalScore: '70',
  maxOpenJobs: '5',
  maxActiveJobs: '3',
  capabilities: '',
  proofTypes: ['signed_result', 'url'],
  autonomousTx: true,
  llmEvaluation: false,
  confirm: false,
};

function activeRoles(mode: EscrowMode): RoleConfig[] {
  if (mode === 'suite') return [ROLE_CONFIG.client, ROLE_CONFIG.provider, ROLE_CONFIG.evaluator];
  return [ROLE_CONFIG[mode]];
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function shortAddress(value: string) {
  if (!value) return '—';
  if (value.length < 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function capabilityList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function toggleItem(list: string[], item: string) {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
}

function walletForRole(form: FormState, role: RoleId) {
  if (role === 'client') return form.clientWallet;
  if (role === 'provider') return form.providerWallet;
  return form.evaluatorWallet;
}

function modeLabel(mode: EscrowMode) {
  if (mode === 'suite') return 'Full Suite';
  return ROLE_CONFIG[mode].title;
}

function FieldShell({
  label,
  required,
  helper,
  children,
}: {
  label: string;
  required?: boolean;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-2 font-mono text-[12px] font-semibold tracking-[-0.02em] text-[#F5F0E5]">
        {label} {required && <span className="text-[#F3C536]">*</span>}
      </div>
      {children}
      {helper && <p className="mt-2 text-[12px] leading-5 text-[#EAE4D8]/48">{helper}</p>}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-12 w-full rounded-md border border-white/10 bg-[#07090D] px-4 text-[14px] text-[#F5F0E5] outline-none transition placeholder:text-[#EAE4D8]/35 focus:border-[#F3C536]/60 focus:ring-2 focus:ring-[#F3C536]/10"
    />
  );
}

function TextareaInput({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full resize-none rounded-md border border-white/10 bg-[#07090D] px-4 py-3 text-[14px] leading-6 text-[#F5F0E5] outline-none transition placeholder:text-[#EAE4D8]/35 focus:border-[#F3C536]/60 focus:ring-2 focus:ring-[#F3C536]/10"
    />
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-12 w-full appearance-none rounded-md border border-white/10 bg-[#07090D] px-4 text-[14px] text-[#F5F0E5] outline-none transition focus:border-[#F3C536]/60 focus:ring-2 focus:ring-[#F3C536]/10"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-[#07090D] text-[#F5F0E5]">
          {option.label}
        </option>
      ))}
    </select>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#07090D]/88 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
      <div className="flex items-center gap-4 px-7 pt-6">
        <div className="flex h-8 w-8 items-center justify-center text-[#F5F0E5]">{icon}</div>
        <h2 className="text-[20px] font-semibold tracking-[-0.04em] text-[#F5F0E5]">{title}</h2>
      </div>
      <div className="px-7 pb-6 pt-5">{children}</div>
    </section>
  );
}

function StepItem({
  number,
  title,
  description,
  active,
}: {
  number: number;
  title: string;
  description: string;
  active?: boolean;
}) {
  return (
    <div className="relative flex gap-5">
      <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/18 bg-[#07090D]">
        <span
          className={
            active
              ? 'flex h-10 w-10 items-center justify-center rounded-full border border-[#F3C536] text-[13px] text-[#F3C536]'
              : 'text-[13px] text-[#EAE4D8]/75'
          }
        >
          {number}
        </span>
      </div>
      <div className="pb-10">
        <div className={active ? 'font-semibold text-[#F3C536]' : 'font-semibold text-[#EAE4D8]/75'}>
          {title}
        </div>
        <div className="mt-1 text-[13px] leading-5 text-[#EAE4D8]/48">{description}</div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-4 text-[13px]">
      <span className="text-[#EAE4D8]/55">{label}</span>
      <span className="min-w-0 truncate text-[#F5F0E5]/85">{value || '—'}</span>
    </div>
  );
}

function RoleButton({
  role,
  active,
  onClick,
}: {
  role: RoleConfig;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-md border border-[#F3C536]/45 bg-[#F3C536]/10 p-4 text-left transition'
          : 'rounded-md border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-[#F3C536]/30 hover:bg-[#F3C536]/[0.04]'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={active ? 'font-semibold text-[#F3C536]' : 'font-semibold text-[#F5F0E5]'}>
            {role.title}
          </div>
          <p className="mt-2 text-[12px] leading-5 text-[#EAE4D8]/55">{role.description}</p>
        </div>
        <div
          className={
            active
              ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[#F3C536] bg-[#F3C536] text-[#07090D]'
              : 'h-6 w-6 shrink-0 rounded border border-white/20'
          }
        >
          {active && <Check className="h-4 w-4" />}
        </div>
      </div>
    </button>
  );
}

export default function ERC8183EscrowRegisterPage() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [notice, setNotice] = useState('');
  const [createdAt] = useState(() => new Date().toISOString());

  const roles = useMemo(() => activeRoles(form.mode), [form.mode]);
  const customCaps = useMemo(() => capabilityList(form.capabilities), [form.capabilities]);

  const manifestDrafts = useMemo(() => {
    const now = new Date().toISOString();
    const baseSlug = slugify(form.agentName) || 'erc8183-runtime';
    const categorySlug = form.category ? slugify(form.category) : '';
    const workTitleSlug = form.workTitle ? slugify(form.workTitle) : '';
    const receiver = form.payoutWallet || form.providerWallet || form.clientWallet || form.evaluatorWallet;

    return roles.map((role) => {
      const wallet = walletForRole(form, role.id);
      const roleCaps = Array.from(
        new Set([
          ...role.capabilities,
          ...customCaps,
          ...(categorySlug ? [categorySlug] : []),
          ...(workTitleSlug ? [workTitleSlug] : []),
        ]),
      );

      return {
        schema: 'arclayer.agent/v1',
        version: 1,
        agentId: `${baseSlug}-${role.id}`,
        name: `${form.agentName || 'ERC-8183 Agent Runtime'} — ${role.label}`,
        role: role.botRole,
        description:
          form.description ||
          'ERC-8183 escrow runtime for matching, executing, evaluating, or funding work orders on Arc Testnet.',
        controller: wallet || undefined,
        endpoint: form.runtimeBaseUrl ? `${form.runtimeBaseUrl.replace(/\/$/, '')}/${role.endpointPath}` : undefined,
        mode: role.mode,
        capability: roleCaps,
        capabilities: roleCaps,
        categories: ['erc8183-commerce', ...(categorySlug ? [categorySlug] : [])],
        roles: [
          {
            id: role.id,
            name: role.title,
            category: form.category || 'Other',
            capabilities: roleCaps,
            endpointPath: role.endpointPath,
            enabled: true,
          },
        ],
        payments: {
          rail: 'erc8183-escrow',
          network: 'arc-testnet',
          currency: 'USDC',
          defaultBudgetAtomic: form.defaultBudgetAtomic,
          receiver: receiver || undefined,
        },
        jobs: {
          accepts: role.accepts,
          inputFormats: ['text', 'json'],
          outputFormats: ['json', 'proof'],
          workOrderDefaults: {
            title: form.workTitle || undefined,
            category: form.category || undefined,
            description: form.description || undefined,
            deliverables: form.deliverables || undefined,
            requirements: form.requirements || undefined,
            timeline: form.timeline || undefined,
            budgetAtomic: form.defaultBudgetAtomic,
          },
        },
        proof: {
          types: form.proofTypes,
          signing: 'eip191',
        },
        host: 'self-hosted-pm2',
        erc8183: {
          enabled: true,
          role: role.id,
          contract: 'AgenticCommerce',
          budgetAtomic: form.defaultBudgetAtomic,
          minEvalScore: Number(form.minEvalScore || 70),
          maxOpenJobs: Number(form.maxOpenJobs || 5),
          maxActiveJobs: Number(form.maxActiveJobs || 3),
          autonomousTx: form.autonomousTx,
          llmEvaluation: form.llmEvaluation,
          scopes: role.scopes,
          workOrderCategory: form.category || undefined,
          timeline: form.timeline || undefined,
        },
        createdAt,
        updatedAt: now,
      };
    });
  }, [form, roles, customCaps, createdAt]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function saveDraft() {
    const payload = {
      type: 'erc8183-runtime-register-draft',
      form,
      manifests: manifestDrafts,
    };

    localStorage.setItem('arclayer-erc8183-runtime-draft', JSON.stringify(payload, null, 2));
    setNotice('Draft saved locally. Payload is ready for ERC-8004 identity + manifest publish wiring.');
  }

  function submitRegister() {
    if (!form.confirm) {
      setNotice('Confirm the information before registering.');
      return;
    }

    const payload = {
      type: 'erc8183-runtime-register-submit',
      form,
      manifests: manifestDrafts,
      nextSteps: [
        'Mint ERC-8004 identity for each selected runtime role.',
        'Replace provisional agentId with minted ERC-8004 tokenId.',
        'Sign manifestHash using the role controller wallet.',
        'POST signed manifest to /api/a2a/manifest.',
        'Generate role-scoped API keys.',
        'Export .env files for ERC-8183 PM2 bots.',
        'Run npm run check:env before PM2 start.',
      ],
    };

    localStorage.setItem('arclayer-erc8183-runtime-submit', JSON.stringify(payload, null, 2));
    console.log('[ArcLayer] ERC-8183 runtime register payload:', payload);
    setNotice('Register payload created. Wire this button to mint identity, publish manifest, generate keys, and export PM2 env.');
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#05070A] text-[#F5F0E5]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(243,197,54,0.075),transparent_28%),radial-gradient(circle_at_72%_10%,rgba(255,255,255,0.05),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_45%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:44px_44px]" />

      <div className="relative grid min-h-screen lg:grid-cols-[520px_1fr]">
        <aside className="border-r border-white/10 px-8 py-8 sm:px-12 lg:px-16">
          <Link
            href="/register"
            className="inline-flex items-center gap-3 font-mono text-[12px] font-semibold tracking-[0.04em] text-[#F3C536] transition hover:text-[#FFE070]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Register
          </Link>

          <div className="mt-14">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#F3C536]">
              ERC-8183 · AGENT RUNTIME
            </div>
            <h1 className="mt-3 text-[34px] font-bold tracking-[-0.055em] text-[#F5F0E5] sm:text-[38px]">
              Register ERC-8183 Runtime
            </h1>
            <p className="mt-5 max-w-[370px] text-[16px] leading-8 text-[#EAE4D8]/62">
              Register a worker, evaluator, or autonomous client runtime for escrow jobs. Manual clients create jobs from the Jobs page without registering an agent.
            </p>
          </div>

          <div className="relative mt-16">
            <div className="absolute left-5 top-10 h-[140px] border-l border-dashed border-white/16" />
            <StepItem number={1} title="Runtime Info" description="Choose role and runtime endpoint" active />
            <StepItem number={2} title="Work Order Defaults" description="Mirror Create Job fields for matching" />
            <StepItem number={3} title="Review & Submit" description="Confirm manifest and register runtime" />
          </div>

          <div className="mt-12 rounded-md border border-[#F3C536]/22 bg-[#F3C536]/[0.025] p-7">
            <div className="flex items-center gap-3 text-[#F3C536]">
              <Workflow className="h-5 w-5" />
              <div className="font-mono text-[13px] font-semibold">Escrow runtime notes</div>
            </div>

            <div className="mt-8 space-y-8">
              <div className="flex gap-5">
                <BriefcaseBusiness className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Worker is the default runtime</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    Use this page to register agents that receive, execute, or evaluate escrow jobs.
                  </p>
                </div>
              </div>

              <div className="flex gap-5">
                <Wallet className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Manual clients stay in Jobs</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    Human users can create and fund escrow jobs manually from Jobs → Create Job.
                  </p>
                </div>
              </div>

              <div className="flex gap-5">
                <Shield className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Private keys never enter ArcLayer</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    Only public controller wallets are saved. Keys stay in the operator runtime or wallet.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="px-5 py-8 sm:px-8 lg:px-14 xl:px-16">
          <div className="mx-auto max-w-[1180px] space-y-3">
            <Section icon={<Bot className="h-6 w-6" />} title="Runtime Info">
              <div className="grid gap-7 lg:grid-cols-2">
                <FieldShell label="Registration Type" required helper="Worker is recommended for agents that receive escrow work orders.">
                  <SelectInput
                    value={form.mode}
                    onChange={(value) => update('mode', value as EscrowMode)}
                    options={[
                      { value: 'provider', label: 'Worker / Provider — receive and submit jobs' },
                      { value: 'evaluator', label: 'Evaluator — review and settle jobs' },
                      { value: 'client', label: 'Autonomous Client Bot — create and fund jobs automatically' },
                      { value: 'suite', label: 'Full Suite — Client Bot + Worker + Evaluator' },
                    ]}
                  />
                </FieldShell>

                <FieldShell label="Agent Runtime Name" required helper="Clear name shown in registry and manifest.">
                  <TextInput
                    value={form.agentName}
                    onChange={(value) => update('agentName', value)}
                    placeholder="e.g., Smart Contract Audit Worker"
                  />
                </FieldShell>

                <div className="lg:col-span-2">
                  <FieldShell label="Runtime Base URL" required helper="Public HTTPS base URL for your self-hosted runtime.">
                    <TextInput
                      value={form.runtimeBaseUrl}
                      onChange={(value) => update('runtimeBaseUrl', value)}
                      placeholder="https://your-erc8183-runtime.com"
                    />
                  </FieldShell>
                </div>

                <div className="lg:col-span-2">
                  <div className="mb-3 font-mono text-[12px] font-semibold tracking-[-0.02em] text-[#F5F0E5]">
                    Role Template <span className="text-[#F3C536]">*</span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <RoleButton
                      role={ROLE_CONFIG.provider}
                      active={roles.some((role) => role.id === 'provider')}
                      onClick={() => update('mode', 'provider')}
                    />
                    <RoleButton
                      role={ROLE_CONFIG.evaluator}
                      active={roles.some((role) => role.id === 'evaluator')}
                      onClick={() => update('mode', 'evaluator')}
                    />
                    <RoleButton
                      role={ROLE_CONFIG.client}
                      active={roles.some((role) => role.id === 'client')}
                      onClick={() => update('mode', 'client')}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => update('mode', 'suite')}
                    className={
                      form.mode === 'suite'
                        ? 'mt-3 w-full rounded-md border border-[#F3C536]/45 bg-[#F3C536]/10 px-4 py-3 text-left font-mono text-[12px] uppercase tracking-[0.12em] text-[#F3C536]'
                        : 'mt-3 w-full rounded-md border border-white/10 bg-white/[0.025] px-4 py-3 text-left font-mono text-[12px] uppercase tracking-[0.12em] text-[#EAE4D8]/55 hover:border-[#F3C536]/30'
                    }
                  >
                    Use Full Suite: Autonomous Client Bot + Worker + Evaluator
                  </button>
                </div>
              </div>
            </Section>

            <Section icon={<ClipboardList className="h-6 w-6" />} title="Work Order Defaults">
              <div className="grid gap-7 lg:grid-cols-2">
                <FieldShell label="Work Order Title" required helper="Matches Job Title in Jobs → Create Job.">
                  <TextInput
                    value={form.workTitle}
                    onChange={(value) => update('workTitle', value)}
                    placeholder="e.g., Smart Contract Security Audit"
                  />
                </FieldShell>

                <FieldShell label="Category" required helper="Same category taxonomy used by manual escrow job creation.">
                  <SelectInput
                    value={form.category}
                    onChange={(value) => update('category', value as Category | '')}
                    options={[
                      { value: '', label: 'Select a category' },
                      ...CATEGORIES.map((category) => ({ value: category, label: category })),
                    ]}
                  />
                </FieldShell>

                <div className="lg:col-span-2">
                  <FieldShell label="Description" required helper="Describe the work this runtime can execute or evaluate.">
                    <TextareaInput
                      value={form.description}
                      onChange={(value) => update('description', value)}
                      placeholder="Describe the work to be done…"
                      rows={4}
                    />
                  </FieldShell>
                </div>

                <FieldShell label="Deliverables" required helper="What the worker should submit when the job is done.">
                  <TextareaInput
                    value={form.deliverables}
                    onChange={(value) => update('deliverables', value)}
                    placeholder="List the key deliverables you expect…"
                    rows={4}
                  />
                </FieldShell>

                <FieldShell label="Requirements" required helper="Completion criteria used by the evaluator or manual reviewer.">
                  <TextareaInput
                    value={form.requirements}
                    onChange={(value) => update('requirements', value)}
                    placeholder="requirements for this job…"
                    rows={4}
                  />
                </FieldShell>

                <FieldShell label="Timeline" required helper="Default deadline template for matching escrow work orders.">
                  <SelectInput
                    value={form.timeline}
                    onChange={(value) => update('timeline', value)}
                    options={TIMELINES.map((timeline) => ({ value: timeline, label: timeline }))}
                  />
                </FieldShell>

                <FieldShell label="Default Escrow Budget Atomic" required helper="Mirrors Escrow Budget in Create Job. Example: 1000 = 0.001 USDC.">
                  <TextInput
                    value={form.defaultBudgetAtomic}
                    onChange={(value) => update('defaultBudgetAtomic', value)}
                    placeholder="1000"
                  />
                </FieldShell>

                <div className="lg:col-span-2">
                  <FieldShell label="Additional Capabilities" helper="Optional comma-separated tags. Category and title are already included for matching.">
                    <TextInput
                      value={form.capabilities}
                      onChange={(value) => update('capabilities', value)}
                      placeholder="audit, security-review, code-review"
                    />

                    {[...customCaps, ...(form.category ? [slugify(form.category)] : [])].length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {Array.from(new Set([...customCaps, ...(form.category ? [slugify(form.category)] : [])])).map((capability) => (
                          <span
                            key={capability}
                            className="rounded-md border border-white/10 bg-white/[0.035] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#EAE4D8]/62"
                          >
                            {capability}
                          </span>
                        ))}
                      </div>
                    )}
                  </FieldShell>
                </div>
              </div>
            </Section>

            <Section icon={<Link2 className="h-6 w-6" />} title="Wallets & Runtime Policy">
              <div className="grid gap-7 lg:grid-cols-2">
                {(form.mode === 'suite' || form.mode === 'client') && (
                  <FieldShell label="Autonomous Client Wallet" required helper="Controller address for a bot that creates and funds jobs automatically.">
                    <TextInput
                      value={form.clientWallet}
                      onChange={(value) => update('clientWallet', value)}
                      placeholder="0x..."
                    />
                  </FieldShell>
                )}

                {(form.mode === 'suite' || form.mode === 'provider') && (
                  <FieldShell label="Worker / Provider Wallet" required helper="Public address for the worker that claims and submits jobs.">
                    <TextInput
                      value={form.providerWallet}
                      onChange={(value) => update('providerWallet', value)}
                      placeholder="0x..."
                    />
                  </FieldShell>
                )}

                {(form.mode === 'suite' || form.mode === 'evaluator') && (
                  <FieldShell label="Evaluator Wallet" required helper="Public address for the evaluator that completes settlement.">
                    <TextInput
                      value={form.evaluatorWallet}
                      onChange={(value) => update('evaluatorWallet', value)}
                      placeholder="0x..."
                    />
                  </FieldShell>
                )}

                <FieldShell label="Payout Wallet" helper="Optional. Defaults to Worker wallet, then Client/Evaluator wallet.">
                  <TextInput
                    value={form.payoutWallet}
                    onChange={(value) => update('payoutWallet', value)}
                    placeholder="0x..."
                  />
                </FieldShell>

                <FieldShell label="Minimum Evaluation Score" required helper="Evaluator completes escrow only if score passes this threshold.">
                  <TextInput
                    value={form.minEvalScore}
                    onChange={(value) => update('minEvalScore', value)}
                    placeholder="70"
                  />
                </FieldShell>

                <FieldShell label="Max Open Jobs" helper="Autonomous client safety guard.">
                  <TextInput
                    value={form.maxOpenJobs}
                    onChange={(value) => update('maxOpenJobs', value)}
                    placeholder="5"
                  />
                </FieldShell>

                <FieldShell label="Max Active Jobs" helper="Worker/evaluator processing guard.">
                  <TextInput
                    value={form.maxActiveJobs}
                    onChange={(value) => update('maxActiveJobs', value)}
                    placeholder="3"
                  />
                </FieldShell>

                <FieldShell label="Proof Types" required helper="Evidence formats for receipt/proof history.">
                  <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-md border border-white/10 bg-[#07090D] px-3 py-2">
                    {PROOF_TYPES.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => update('proofTypes', toggleItem(form.proofTypes, item))}
                        className={
                          form.proofTypes.includes(item)
                            ? 'rounded-md border border-[#F3C536]/40 bg-[#F3C536]/12 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#F3C536]'
                            : 'rounded-md border border-white/10 bg-white/[0.025] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#EAE4D8]/50'
                        }
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </FieldShell>

                <FieldShell label="Runtime Options" helper="Stored as runtime policy metadata, not secrets.">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => update('autonomousTx', !form.autonomousTx)}
                      className={
                        form.autonomousTx
                          ? 'rounded-md border border-[#F3C536]/40 bg-[#F3C536]/12 px-4 py-3 text-left text-[13px] text-[#F3C536]'
                          : 'rounded-md border border-white/10 bg-white/[0.025] px-4 py-3 text-left text-[13px] text-[#EAE4D8]/55'
                      }
                    >
                      <div className="font-semibold">Autonomous TX</div>
                      <div className="mt-1 text-[11px] opacity-70">Runtime can sign on-chain actions</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => update('llmEvaluation', !form.llmEvaluation)}
                      className={
                        form.llmEvaluation
                          ? 'rounded-md border border-[#F3C536]/40 bg-[#F3C536]/12 px-4 py-3 text-left text-[13px] text-[#F3C536]'
                          : 'rounded-md border border-white/10 bg-white/[0.025] px-4 py-3 text-left text-[13px] text-[#EAE4D8]/55'
                      }
                    >
                      <div className="font-semibold">LLM Evaluation</div>
                      <div className="mt-1 text-[11px] opacity-70">Evaluator can use LLM</div>
                    </button>
                  </div>
                </FieldShell>
              </div>
            </Section>

            <Section icon={<FileJson className="h-6 w-6" />} title="Review">
              <div className="grid gap-8 xl:grid-cols-[1fr_430px]">
                <div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-3">
                      <ReviewRow label="Runtime Name" value={form.agentName} />
                      <ReviewRow label="Type" value={modeLabel(form.mode)} />
                      <ReviewRow label="Work Title" value={form.workTitle} />
                      <ReviewRow label="Category" value={form.category} />
                      <ReviewRow label="Runtime" value={form.runtimeBaseUrl} />
                      <ReviewRow label="Timeline" value={form.timeline} />
                    </div>

                    <div className="space-y-3">
                      <ReviewRow label="Budget Atomic" value={form.defaultBudgetAtomic} />
                      <ReviewRow label="Client Wallet" value={shortAddress(form.clientWallet)} />
                      <ReviewRow label="Worker Wallet" value={shortAddress(form.providerWallet)} />
                      <ReviewRow label="Evaluator Wallet" value={shortAddress(form.evaluatorWallet)} />
                      <ReviewRow label="Payout" value={shortAddress(form.payoutWallet || form.providerWallet)} />
                      <ReviewRow label="Proof" value={form.proofTypes.join(', ')} />
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4">
                    {([
                      ['Description', form.description],
                      ['Deliverables', form.deliverables],
                      ['Requirements', form.requirements],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="rounded-md border border-white/10 bg-[#05070A] p-4">
                        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#F3C536]">
                          {label}
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[#F5F0E5]/78">
                          {value || '—'}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 rounded-md border border-white/10 bg-[#05070A]">
                    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                      <KeyRound className="h-4 w-4 text-[#F3C536]" />
                      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#F3C536]">
                        API Scopes
                      </div>
                    </div>

                    <div className="divide-y divide-white/10">
                      {roles.map((role) => (
                        <div key={role.id} className="grid gap-3 px-4 py-4 md:grid-cols-[120px_1fr]">
                          <div className="font-semibold text-[#F5F0E5]">{role.label}</div>
                          <div className="flex flex-wrap gap-2">
                            {role.scopes.map((scope) => (
                              <span
                                key={scope}
                                className="rounded border border-white/10 bg-white/[0.025] px-2 py-1 font-mono text-[10px] tracking-[0.06em] text-[#EAE4D8]/60"
                              >
                                {scope}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <label className="mt-6 flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.025] p-4">
                    <button
                      type="button"
                      onClick={() => update('confirm', !form.confirm)}
                      className={
                        form.confirm
                          ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#F3C536] bg-[#F3C536] text-[#07090D]'
                          : 'mt-0.5 h-5 w-5 shrink-0 rounded border border-white/25'
                      }
                    >
                      {form.confirm && <Check className="h-3.5 w-3.5" />}
                    </button>
                    <span className="text-[13px] leading-6 text-[#EAE4D8]/62">
                      I understand this registers ERC-8183 runtimes only. Manual clients should create jobs from Jobs → Create Job and do not need an agent identity.
                    </span>
                  </label>
                </div>

                <div className="rounded-md border border-white/10 bg-[#05070A]">
                  <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                    <FileJson className="h-4 w-4 text-[#F3C536]" />
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#F3C536]">
                      Manifest Preview
                    </div>
                  </div>
                  <pre className="max-h-[640px] overflow-auto p-4 text-[11px] leading-5 text-[#EAE4D8]/62">
                    {JSON.stringify(manifestDrafts, null, 2)}
                  </pre>
                </div>
              </div>
            </Section>

            {notice && (
              <div className="rounded-md border border-[#F3C536]/25 bg-[#F3C536]/[0.045] px-5 py-4 text-[13px] leading-6 text-[#F3C536]">
                {notice}
              </div>
            )}

            <div className="sticky bottom-0 z-20 flex flex-col gap-4 rounded-t-xl border-t border-white/10 bg-[#05070A]/92 px-5 py-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] leading-6 text-[#EAE4D8]/55">
                Save a local draft now. Wiring for mint identity, publish manifest, API keys, and PM2 env export is deferred.
              </p>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={saveDraft}
                  className="h-12 rounded-md border border-[#F3C536]/35 bg-transparent px-8 text-[13px] font-semibold text-[#F3C536] transition hover:border-[#F3C536]/70 hover:bg-[#F3C536]/8"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  onClick={submitRegister}
                  className="h-12 rounded-md border border-[#F3C536] bg-[#F3C536] px-9 text-[13px] font-semibold text-[#07090D] transition hover:bg-[#FFE070]"
                >
                  Register Runtime
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
