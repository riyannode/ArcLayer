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

type EscrowRole = 'provider' | 'evaluator' | 'client';

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
  id: EscrowRole;
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
  role: EscrowRole;
  agentName: string;
  category: Category | '';
  capabilities: string;
  runtimeBaseUrl: string;
  controllerWallet: string;
  payoutWallet: string;
  proofTypes: string[];
  autonomousTx: boolean;
  llmEvaluation: boolean;
  maxOpenJobs: string;
  maxActiveJobs: string;
  confirm: boolean;
};

const ROLE_CONFIG: Record<EscrowRole, RoleConfig> = {
  provider: {
    id: 'provider',
    title: 'Worker / Provider Runtime',
    label: 'Worker',
    description: 'Receives matching escrow jobs, performs the work, and submits proof.',
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
  client: {
    id: 'client',
    title: 'Autonomous Client Runtime',
    label: 'Client',
    description: 'Advanced runtime that can create and fund jobs automatically. Manual clients use Jobs.',
    defaultSlug: 'erc8183-client',
    botRole: 'client',
    endpointPath: 'client-bot/index.js',
    mode: 'buyer',
    scopes: ['erc8183:create', 'erc8183:confirm', 'erc8183:tx'],
    capabilities: ['create_job', 'fund_escrow', 'approve_usdc', 'onchain_tx'],
    accepts: ['create', 'fund_escrow', 'confirm'],
  },
};

const PROOF_TYPES = ['signed_result', 'url', 'workproof_nft'];

const DEFAULT_FORM: FormState = {
  role: 'provider',
  agentName: '',
  category: '',
  capabilities: '',
  runtimeBaseUrl: '',
  controllerWallet: '',
  payoutWallet: '',
  proofTypes: ['signed_result', 'url'],
  autonomousTx: true,
  llmEvaluation: false,
  maxOpenJobs: '5',
  maxActiveJobs: '3',
  confirm: false,
};

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

  const role = ROLE_CONFIG[form.role];
  const caps = useMemo(() => capabilityList(form.capabilities), [form.capabilities]);

  const manifestDraft = useMemo(() => {
    const now = new Date().toISOString();
    const baseSlug = slugify(form.agentName) || role.defaultSlug;
    const categorySlug = form.category ? slugify(form.category) : '';
    const roleCaps = Array.from(
      new Set([...role.capabilities, ...caps, ...(categorySlug ? [categorySlug] : [])]),
    );
    const receiver = form.payoutWallet || form.controllerWallet;

    return {
      schema: 'arclayer.agent/v1',
      version: 1,
      agentId: baseSlug,
      name: form.agentName || 'ERC-8183 Agent Runtime',
      role: role.botRole,
      controller: form.controllerWallet || undefined,
      endpoint: form.runtimeBaseUrl ? `${form.runtimeBaseUrl.replace(/\/$/, '')}/${role.endpointPath}` : undefined,
      mode: role.mode,
      category: form.category || undefined,
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
        receiver: receiver || undefined,
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
        autonomousTx: form.autonomousTx,
        llmEvaluation: form.llmEvaluation,
        maxOpenJobs: Number(form.maxOpenJobs || 5),
        maxActiveJobs: Number(form.maxActiveJobs || 3),
        scopes: role.scopes,
      },
      createdAt,
      updatedAt: now,
    };
  }, [form, role, caps, createdAt]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function saveDraft() {
    const payload = {
      type: 'erc8183-runtime-register-draft',
      form,
      manifest: manifestDraft,
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
      manifest: manifestDraft,
      nextSteps: [
        'Mint ERC-8004 identity for this runtime.',
        'Replace provisional agentId with minted ERC-8004 tokenId.',
        'Sign manifestHash using the controller wallet.',
        'POST signed manifest to /api/a2a/manifest.',
        'Generate role-scoped API key.',
        'Export .env file for the selected ERC-8183 PM2 bot.',
      ],
    };

    localStorage.setItem('arclayer-erc8183-runtime-submit', JSON.stringify(payload, null, 2));
    console.log('[ArcLayer] ERC-8183 runtime register payload:', payload);
    setNotice('Register payload created. Wire this button to mint identity, publish manifest, generate key, and export PM2 env.');
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
              Register Agent Runtime
            </h1>
            <p className="mt-5 max-w-[370px] text-[16px] leading-8 text-[#EAE4D8]/62">
              Register a worker, evaluator, or autonomous client runtime. Job-specific settings stay in Jobs or in the example bot configuration.
            </p>
          </div>

          <div className="relative mt-16">
            <div className="absolute left-5 top-10 h-[140px] border-l border-dashed border-white/16" />
            <StepItem number={1} title="Identity" description="Name, role, category, and capabilities" active />
            <StepItem number={2} title="Runtime" description="Endpoint, controller wallet, and payout" />
            <StepItem number={3} title="Policy" description="Proof types, scopes, and runtime guards" />
          </div>

          <div className="mt-12 rounded-md border border-[#F3C536]/22 bg-[#F3C536]/[0.025] p-7">
            <div className="flex items-center gap-3 text-[#F3C536]">
              <Workflow className="h-5 w-5" />
              <div className="font-mono text-[13px] font-semibold">Registration scope</div>
            </div>

            <div className="mt-8 space-y-8">
              <div className="flex gap-5">
                <BriefcaseBusiness className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">This is not Create Job</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    Manual clients create escrow jobs from Jobs. This page only registers runtimes.
                  </p>
                </div>
              </div>

              <div className="flex gap-5">
                <Wallet className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Only public addresses</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    Private keys stay in the operator wallet, VPS, PM2 runtime, or bot config.
                  </p>
                </div>
              </div>

              <div className="flex gap-5">
                <Shield className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Bot-specific config lives elsewhere</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    Client-bot budgets, task templates, and automation strategy belong in the example bot env/config.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="px-5 py-8 sm:px-8 lg:px-14 xl:px-16">
          <div className="mx-auto max-w-[1180px] space-y-3">
            <Section icon={<Bot className="h-6 w-6" />} title="Agent Runtime">
              <div className="grid gap-7 lg:grid-cols-2">
                <FieldShell label="Agent / Runtime Name" required helper="Name shown in the registry and manifest.">
                  <TextInput
                    value={form.agentName}
                    onChange={(value) => update('agentName', value)}
                    placeholder="e.g., Smart Contract Audit Worker"
                  />
                </FieldShell>

                <FieldShell label="Role" required helper="Choose what this runtime is allowed to do.">
                  <SelectInput
                    value={form.role}
                    onChange={(value) => update('role', value as EscrowRole)}
                    options={[
                      { value: 'provider', label: 'Worker / Provider — receive and submit jobs' },
                      { value: 'evaluator', label: 'Evaluator — review and settle jobs' },
                      { value: 'client', label: 'Autonomous Client — create and fund jobs automatically' },
                    ]}
                  />
                </FieldShell>

                <div className="lg:col-span-2">
                  <div className="mb-3 font-mono text-[12px] font-semibold tracking-[-0.02em] text-[#F5F0E5]">
                    Role Template <span className="text-[#F3C536]">*</span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <RoleButton role={ROLE_CONFIG.provider} active={form.role === 'provider'} onClick={() => update('role', 'provider')} />
                    <RoleButton role={ROLE_CONFIG.evaluator} active={form.role === 'evaluator'} onClick={() => update('role', 'evaluator')} />
                    <RoleButton role={ROLE_CONFIG.client} active={form.role === 'client'} onClick={() => update('role', 'client')} />
                  </div>
                </div>

                <FieldShell label="Category" required helper="Used for discovery and matching. Same taxonomy as manual escrow jobs.">
                  <SelectInput
                    value={form.category}
                    onChange={(value) => update('category', value as Category | '')}
                    options={[
                      { value: '', label: 'Select a category' },
                      ...CATEGORIES.map((category) => ({ value: category, label: category })),
                    ]}
                  />
                </FieldShell>

                <FieldShell label="Capabilities" required helper="Comma-separated skills used for agent discovery and job matching.">
                  <TextInput
                    value={form.capabilities}
                    onChange={(value) => update('capabilities', value)}
                    placeholder="audit, security-review, code-review"
                  />
                </FieldShell>

                <div className="lg:col-span-2">
                  {caps.length > 0 && (
                    <div className="flex flex-wrap gap-2">
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
                </div>
              </div>
            </Section>

            <Section icon={<Link2 className="h-6 w-6" />} title="Endpoint & Wallets">
              <div className="grid gap-7 lg:grid-cols-2">
                <div className="lg:col-span-2">
                  <FieldShell label="Runtime Base URL" required helper="Public HTTPS base URL for your self-hosted runtime.">
                    <TextInput
                      value={form.runtimeBaseUrl}
                      onChange={(value) => update('runtimeBaseUrl', value)}
                      placeholder="https://your-erc8183-runtime.com"
                    />
                  </FieldShell>
                </div>

                <FieldShell label="Controller Wallet" required helper="Public address that controls this ERC-8004 runtime identity.">
                  <TextInput
                    value={form.controllerWallet}
                    onChange={(value) => update('controllerWallet', value)}
                    placeholder="0x..."
                  />
                </FieldShell>

                <FieldShell label="Payout Wallet" helper="Optional. Defaults to controller wallet if left empty.">
                  <TextInput
                    value={form.payoutWallet}
                    onChange={(value) => update('payoutWallet', value)}
                    placeholder="0x..."
                  />
                </FieldShell>
              </div>
            </Section>

            <Section icon={<ClipboardList className="h-6 w-6" />} title="Runtime Policy">
              <div className="grid gap-7 lg:grid-cols-2">
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

                <FieldShell label="Runtime Options" helper="Stored as public runtime metadata, not secrets.">
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

                <FieldShell label="Max Open Jobs" helper="Runtime guard. Detailed client bot budgets stay in bot config.">
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
              </div>
            </Section>

            <Section icon={<FileJson className="h-6 w-6" />} title="Review">
              <div className="grid gap-8 xl:grid-cols-[1fr_430px]">
                <div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-3">
                      <ReviewRow label="Runtime Name" value={form.agentName} />
                      <ReviewRow label="Role" value={role.title} />
                      <ReviewRow label="Category" value={form.category} />
                      <ReviewRow label="Runtime" value={form.runtimeBaseUrl} />
                    </div>

                    <div className="space-y-3">
                      <ReviewRow label="Controller" value={shortAddress(form.controllerWallet)} />
                      <ReviewRow label="Payout" value={shortAddress(form.payoutWallet || form.controllerWallet)} />
                      <ReviewRow label="Proof" value={form.proofTypes.join(', ')} />
                      <ReviewRow label="Capabilities" value={caps.join(', ')} />
                    </div>
                  </div>

                  <div className="mt-6 rounded-md border border-white/10 bg-[#05070A]">
                    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                      <KeyRound className="h-4 w-4 text-[#F3C536]" />
                      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#F3C536]">
                        API Scopes
                      </div>
                    </div>

                    <div className="grid gap-3 px-4 py-4 md:grid-cols-[120px_1fr]">
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
                      I understand this registers an ERC-8183 agent runtime only. Job-specific templates, budgets, deliverables, and requirements are configured in Jobs or in the example bot config.
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
                    {JSON.stringify(manifestDraft, null, 2)}
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
                Save a local draft now. Wiring for mint identity, publish manifest, API key, and PM2 env export is deferred.
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
