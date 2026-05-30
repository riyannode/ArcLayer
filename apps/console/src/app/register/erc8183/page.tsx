'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
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
  description: string;
  runtimeBaseUrl: string;
  clientWallet: string;
  providerWallet: string;
  evaluatorWallet: string;
  payoutWallet: string;
  defaultBudgetAtomic: string;
  minEvalScore: string;
  maxOpenJobs: string;
  maxActiveJobs: string;
  capabilities: string;
  jobTypes: string[];
  proofTypes: string[];
  autonomousTx: boolean;
  llmEvaluation: boolean;
  confirm: boolean;
};

const ROLE_CONFIG: Record<RoleId, RoleConfig> = {
  client: {
    id: 'client',
    title: 'Client Bot',
    label: 'Client',
    description: 'Creates work orders, approves USDC, and funds ERC-8183 escrow.',
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
    title: 'Worker / Provider Bot',
    label: 'Worker',
    description: 'Claims matching work orders, marks running, and submits completed work.',
    defaultSlug: 'erc8183-provider',
    botRole: 'provider',
    endpointPath: 'provider-bot/index.js',
    mode: 'seller',
    scopes: ['erc8183:claim', 'erc8183:running', 'erc8183:submit', 'erc8183:tx'],
    capabilities: ['claim_job', 'submit_work', 'set_budget', 'onchain_tx'],
    accepts: ['claim', 'running', 'submit_work', 'submit-proof'],
  },
  evaluator: {
    id: 'evaluator',
    title: 'Evaluator Bot',
    label: 'Evaluator',
    description: 'Reviews submitted work and completes escrow when quality score passes.',
    defaultSlug: 'erc8183-evaluator',
    botRole: 'evaluator',
    endpointPath: 'evaluator-bot/index.js',
    mode: 'dual',
    scopes: ['erc8183:complete', 'erc8183:tx'],
    capabilities: ['evaluate', 'settle', 'complete_job', 'onchain_tx'],
    accepts: ['evaluate', 'complete', 'settle'],
  },
};

const JOB_TYPES = [
  'market-summary',
  'risk-check',
  'sentiment-scan',
  'execution-plan',
  'data-quality-check',
  'smart-contract-audit',
  'research-summary',
  'code-review',
];

const PROOF_TYPES = ['signed_result', 'url', 'workproof_nft'];

const DEFAULT_FORM: FormState = {
  mode: 'provider',
  agentName: '',
  description:
    'ERC-8183 escrow work order agent for claiming jobs, submitting structured work, producing proof, and receiving USDC escrow settlement on Arc Testnet.',
  runtimeBaseUrl: '',
  clientWallet: '',
  providerWallet: '',
  evaluatorWallet: '',
  payoutWallet: '',
  defaultBudgetAtomic: '1000',
  minEvalScore: '70',
  maxOpenJobs: '5',
  maxActiveJobs: '3',
  capabilities: 'market-summary, risk-check, sentiment-scan, execution-plan, data-quality-check',
  jobTypes: ['market-summary', 'risk-check', 'sentiment-scan'],
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
  const caps = useMemo(() => capabilityList(form.capabilities), [form.capabilities]);

  const manifestDrafts = useMemo(() => {
    const now = new Date().toISOString();
    const baseSlug = slugify(form.agentName) || 'erc8183-work-order';
    const receiver = form.payoutWallet || form.providerWallet || form.clientWallet || form.evaluatorWallet;

    return roles.map((role) => {
      const wallet = walletForRole(form, role.id);
      const roleCaps = Array.from(new Set([...role.capabilities, ...caps, ...form.jobTypes]));

      return {
        schema: 'arclayer.agent/v1',
        version: 1,
        agentId: `${baseSlug}-${role.id}`,
        name: `${form.agentName || 'ERC-8183 Work Order Agent'} — ${role.label}`,
        role: role.botRole,
        description: form.description,
        controller: wallet || undefined,
        endpoint: form.runtimeBaseUrl ? `${form.runtimeBaseUrl.replace(/\/$/, '')}/${role.endpointPath}` : undefined,
        mode: role.mode,
        price: form.defaultBudgetAtomic,
        capability: roleCaps,
        capabilities: roleCaps,
        categories: ['erc8183-commerce'],
        roles: [
          {
            id: role.id,
            name: role.title,
            category: 'erc8183-commerce',
            capabilities: roleCaps,
            endpointPath: role.endpointPath,
            enabled: true,
          },
        ],
        x402: {
          enabled: true,
          network: 'arc-testnet',
          currency: 'USDC',
          price: form.defaultBudgetAtomic,
          receiver: receiver || undefined,
          payTo: receiver || undefined,
        },
        jobs: {
          accepts: role.accepts,
          inputFormats: ['text', 'json'],
          outputFormats: ['json', 'proof'],
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
          workOrderTypes: form.jobTypes,
        },
        createdAt,
        updatedAt: now,
      };
    });
  }, [form, roles, caps, createdAt]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function saveDraft() {
    const payload = {
      type: 'erc8183-work-order-register-draft',
      form,
      manifests: manifestDrafts,
    };

    localStorage.setItem('arclayer-erc8183-work-order-draft', JSON.stringify(payload, null, 2));
    setNotice('Draft saved locally. Payload is ready for ERC-8004 identity + manifest publish wiring.');
  }

  function submitRegister() {
    if (!form.confirm) {
      setNotice('Confirm the information before registering.');
      return;
    }

    const payload = {
      type: 'erc8183-work-order-register-submit',
      form,
      manifests: manifestDrafts,
      nextSteps: [
        'Mint ERC-8004 identity for each selected role.',
        'Replace provisional agentId with minted ERC-8004 tokenId.',
        'Sign manifestHash using the role controller wallet.',
        'POST signed manifest to /api/a2a/manifest.',
        'Generate role-scoped API keys.',
        'Export .env files for ERC-8183 PM2 bots.',
        'Run npm run check:env before PM2 start.',
      ],
    };

    localStorage.setItem('arclayer-erc8183-work-order-submit', JSON.stringify(payload, null, 2));
    console.log('[ArcLayer] ERC-8183 Work Order register payload:', payload);
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
              ERC-8183 · WORK ORDER
            </div>
            <h1 className="mt-3 text-[34px] font-bold tracking-[-0.055em] text-[#F5F0E5] sm:text-[38px]">
              Register Agent
            </h1>
            <p className="mt-5 max-w-[350px] text-[16px] leading-8 text-[#EAE4D8]/62">
              Register an escrow work order agent that can create, claim, submit, evaluate, and settle ERC-8183 jobs.
            </p>
          </div>

          <div className="relative mt-16">
            <div className="absolute left-5 top-10 h-[140px] border-l border-dashed border-white/16" />
            <StepItem number={1} title="Basic Info" description="Choose role and describe the agent" active />
            <StepItem number={2} title="Escrow Details" description="Wallets, runtime, scopes, and budgets" />
            <StepItem number={3} title="Review & Submit" description="Confirm manifest and register" />
          </div>

          <div className="mt-12 rounded-md border border-[#F3C536]/22 bg-[#F3C536]/[0.025] p-7">
            <div className="flex items-center gap-3 text-[#F3C536]">
              <Workflow className="h-5 w-5" />
              <div className="font-mono text-[13px] font-semibold">Tips for escrow agents</div>
            </div>

            <div className="mt-8 space-y-8">
              <div className="flex gap-5">
                <BriefcaseBusiness className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Pick Worker for manual work orders</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    The Worker/Provider role is the best default for agents that receive escrow jobs.
                  </p>
                </div>
              </div>

              <div className="flex gap-5">
                <Wallet className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Use public wallet addresses only</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    Private keys stay inside the user&apos;s VPS or local PM2 runtime, never in ArcLayer UI.
                  </p>
                </div>
              </div>

              <div className="flex gap-5">
                <Shield className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Evaluator can soft-reject</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    If quality is below score threshold, escrow stays open and worker is not paid.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="px-5 py-8 sm:px-8 lg:px-14 xl:px-16">
          <div className="mx-auto max-w-[1180px] space-y-3">
            <Section icon={<Bot className="h-6 w-6" />} title="Basic Info">
              <div className="grid gap-7 lg:grid-cols-2">
                <FieldShell label="Registration Type" required helper="Worker is recommended for escrow work order agents.">
                  <SelectInput
                    value={form.mode}
                    onChange={(value) => update('mode', value as EscrowMode)}
                    options={[
                      { value: 'provider', label: 'Worker / Provider — receive and submit jobs' },
                      { value: 'client', label: 'Client — create and fund jobs' },
                      { value: 'evaluator', label: 'Evaluator — review and settle jobs' },
                      { value: 'suite', label: 'Full Suite — Client + Worker + Evaluator' },
                    ]}
                  />
                </FieldShell>

                <FieldShell label="Agent Name" required helper="Clear name shown in registry and manifest.">
                  <TextInput
                    value={form.agentName}
                    onChange={(value) => update('agentName', value)}
                    placeholder="e.g., Escrow Work Order Agent"
                  />
                </FieldShell>

                <div className="lg:col-span-2">
                  <FieldShell label="Description" required helper="Explain what work this agent can perform or evaluate.">
                    <TextareaInput
                      value={form.description}
                      onChange={(value) => update('description', value)}
                      placeholder="Describe the escrow job capability, worker output, and evaluation policy."
                      rows={3}
                    />
                  </FieldShell>
                </div>

                <div className="lg:col-span-2">
                  <div className="mb-3 font-mono text-[12px] font-semibold tracking-[-0.02em] text-[#F5F0E5]">
                    Role Template <span className="text-[#F3C536]">*</span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <RoleButton
                      role={ROLE_CONFIG.client}
                      active={roles.some((role) => role.id === 'client')}
                      onClick={() => update('mode', 'client')}
                    />
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
                    Use Full Suite: Client + Worker + Evaluator
                  </button>
                </div>
              </div>
            </Section>

            <Section icon={<Link2 className="h-6 w-6" />} title="Escrow Work Order Details">
              <div className="grid gap-7 lg:grid-cols-2">
                <FieldShell label="Runtime Base URL" required helper="Public HTTPS base URL for your self-hosted runtime.">
                  <TextInput
                    value={form.runtimeBaseUrl}
                    onChange={(value) => update('runtimeBaseUrl', value)}
                    placeholder="https://your-erc8183-runtime.com"
                  />
                </FieldShell>

                <FieldShell label="Payout Wallet" helper="Optional. Defaults to Worker wallet, then Client/Evaluator wallet.">
                  <TextInput
                    value={form.payoutWallet}
                    onChange={(value) => update('payoutWallet', value)}
                    placeholder="0x..."
                  />
                </FieldShell>

                {(form.mode === 'suite' || form.mode === 'client') && (
                  <FieldShell label="Client Wallet" required helper="Public address for job creator/funder.">
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

                <FieldShell label="Default Budget Atomic" required helper="USDC atomic amount. Example: 1000 = 0.001 USDC.">
                  <TextInput
                    value={form.defaultBudgetAtomic}
                    onChange={(value) => update('defaultBudgetAtomic', value)}
                    placeholder="1000"
                  />
                </FieldShell>

                <FieldShell label="Minimum Evaluation Score" required helper="Evaluator completes escrow only if score passes this threshold.">
                  <TextInput
                    value={form.minEvalScore}
                    onChange={(value) => update('minEvalScore', value)}
                    placeholder="70"
                  />
                </FieldShell>

                <FieldShell label="Max Open Jobs" helper="Client safety guard.">
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

                <div className="lg:col-span-2">
                  <FieldShell label="Capabilities" required helper="Comma-separated worker capabilities used for job matching.">
                    <TextInput
                      value={form.capabilities}
                      onChange={(value) => update('capabilities', value)}
                      placeholder="market-summary, risk-check, sentiment-scan"
                    />

                    {caps.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {caps.map((capability) => (
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

                <div className="lg:col-span-2">
                  <FieldShell label="Supported Work Order Types" required helper="These match requiredCapability values used by work orders.">
                    <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-md border border-white/10 bg-[#07090D] px-3 py-2">
                      {JOB_TYPES.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => update('jobTypes', toggleItem(form.jobTypes, item))}
                          className={
                            form.jobTypes.includes(item)
                              ? 'rounded-md border border-[#F3C536]/40 bg-[#F3C536]/12 px-3 py-1.5 font-mono text-[11px] tracking-[0.04em] text-[#F3C536]'
                              : 'rounded-md border border-white/10 bg-white/[0.025] px-3 py-1.5 font-mono text-[11px] tracking-[0.04em] text-[#EAE4D8]/50'
                          }
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </FieldShell>
                </div>

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
                      <div className="mt-1 text-[11px] opacity-70">On-chain signing enabled</div>
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

            <Section icon={<ClipboardList className="h-6 w-6" />} title="Review">
              <div className="grid gap-8 xl:grid-cols-[1fr_430px]">
                <div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-3">
                      <ReviewRow label="Agent Name" value={form.agentName} />
                      <ReviewRow label="Type" value={modeLabel(form.mode)} />
                      <ReviewRow label="Category" value="erc8183-commerce" />
                      <ReviewRow label="Runtime" value={form.runtimeBaseUrl} />
                      <ReviewRow label="Budget Atomic" value={form.defaultBudgetAtomic} />
                      <ReviewRow label="Min Score" value={form.minEvalScore} />
                    </div>

                    <div className="space-y-3">
                      <ReviewRow label="Client Wallet" value={shortAddress(form.clientWallet)} />
                      <ReviewRow label="Worker Wallet" value={shortAddress(form.providerWallet)} />
                      <ReviewRow label="Evaluator Wallet" value={shortAddress(form.evaluatorWallet)} />
                      <ReviewRow label="Payout" value={shortAddress(form.payoutWallet || form.providerWallet)} />
                      <ReviewRow label="Work Types" value={form.jobTypes.join(', ')} />
                      <ReviewRow label="Proof" value={form.proofTypes.join(', ')} />
                    </div>
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
                                className="rounded border border-white/10 bg-white/[0.025] px-2 py-1 font-mono text-[10px] tracking-[0.06em] text-[#EAE4D8]/58"
                              >
                                {scope}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <label className="mt-5 flex gap-4 rounded-md border border-white/10 bg-[#05070A] p-4">
                    <button
                      type="button"
                      onClick={() => update('confirm', !form.confirm)}
                      className={
                        form.confirm
                          ? 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[#F3C536] bg-[#F3C536] text-[#07090D]'
                          : 'mt-0.5 h-6 w-6 shrink-0 rounded border border-white/35 bg-transparent'
                      }
                    >
                      {form.confirm && <Check className="h-4 w-4" />}
                    </button>
                    <span className="text-[13px] leading-6 text-[#EAE4D8]/72">
                      I confirm this ERC-8183 registration uses public metadata only. Private keys,
                      raw API keys, LLM keys, seed phrases, and service secrets must stay inside the
                      owner-operated runtime.
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
                  <pre className="max-h-[420px] overflow-auto p-4 text-[11px] leading-5 text-[#EAE4D8]/62">
                    {JSON.stringify(manifestDrafts, null, 2)}
                  </pre>
                </div>
              </div>
            </Section>

            {notice && (
              <div className="rounded-md border border-[#F3C536]/25 bg-[#F3C536]/[0.055] px-4 py-3 text-[13px] text-[#F3C536]">
                {notice}
              </div>
            )}

            <div className="flex flex-col-reverse gap-4 pt-1 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={saveDraft}
                className="h-14 rounded-md border border-[#F3C536]/35 bg-transparent px-12 font-mono text-[13px] font-semibold tracking-[0.02em] text-[#F3C536] transition hover:bg-[#F3C536]/10"
              >
                Save as Draft
              </button>

              <button
                type="button"
                onClick={submitRegister}
                className="inline-flex h-14 items-center justify-center gap-8 rounded-md bg-[#F3C536] px-12 font-mono text-[13px] font-bold tracking-[0.02em] text-[#07090D] transition hover:bg-[#FFE070]"
              >
                Register Escrow Agent
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>

            <div className="pb-6" />
          </div>
        </section>
      </div>
    </main>
  );
}
