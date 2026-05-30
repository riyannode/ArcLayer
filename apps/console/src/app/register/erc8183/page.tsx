'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  Check,
  FileJson,
  KeyRound,
  Shield,
  Wallet,
  Workflow,
} from 'lucide-react';

type AgentRole = 'worker' | 'evaluator' | 'autonomous-client';

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
  id: AgentRole;
  title: string;
  label: string;
  description: string;
  identityRole: string;
  defaultCapabilities: string[];
};

type FormState = {
  agentName: string;
  role: AgentRole;
  category: Category | '';
  capabilities: string;
  controllerWallet: string;
  metadataUri: string;
  confirm: boolean;
};

const ROLE_CONFIG: Record<AgentRole, RoleConfig> = {
  worker: {
    id: 'worker',
    title: 'Worker Agent',
    label: 'Worker',
    description: 'Agent identity for providers that can receive escrow jobs and submit work proofs.',
    identityRole: 'provider',
    defaultCapabilities: ['claim_job', 'submit_work'],
  },
  evaluator: {
    id: 'evaluator',
    title: 'Evaluator Agent',
    label: 'Evaluator',
    description: 'Agent identity for evaluators that can review submitted work and settle escrow jobs.',
    identityRole: 'evaluator',
    defaultCapabilities: ['evaluate_work', 'complete_job'],
  },
  'autonomous-client': {
    id: 'autonomous-client',
    title: 'Autonomous Client Agent',
    label: 'Client',
    description:
      'Agent identity for client bots. Automation, budget, and strategy are configured separately in the example bot.',
    identityRole: 'client',
    defaultCapabilities: ['create_job', 'fund_escrow'],
  },
};

const DEFAULT_FORM: FormState = {
  agentName: '',
  role: 'worker',
  category: '',
  capabilities: '',
  controllerWallet: '',
  metadataUri: '',
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
  const customCaps = useMemo(() => capabilityList(form.capabilities), [form.capabilities]);

  const identityMetadata = useMemo(() => {
    const categorySlug = form.category ? slugify(form.category) : '';
    const allCaps = Array.from(
      new Set([...role.defaultCapabilities, ...customCaps, ...(categorySlug ? [categorySlug] : [])]),
    );

    return {
      schema: 'arclayer.identity/v1',
      standard: 'ERC-8004',
      name: form.agentName || 'ArcLayer Agent',
      role: role.identityRole,
      category: form.category || undefined,
      capabilities: allCaps,
      controller: form.controllerWallet || undefined,
      metadataURI: form.metadataUri || undefined,
      tags: ['erc8183', 'agentic-commerce', ...(categorySlug ? [categorySlug] : [])],
      note: 'Identity only. Runtime URL, bot strategy, budgets, deliverables, requirements, and automation settings live outside this registration flow.',
      createdAt,
    };
  }, [form.agentName, form.category, form.controllerWallet, form.metadataUri, role, customCaps, createdAt]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function saveDraft() {
    const payload = {
      type: 'erc8004-agent-identity-draft',
      form,
      identityMetadata,
    };

    localStorage.setItem('arclayer-erc8004-agent-identity-draft', JSON.stringify(payload, null, 2));
    setNotice('Identity draft saved locally. Bot/runtime settings are intentionally not included.');
  }

  function submitRegister() {
    if (!form.confirm) {
      setNotice('Confirm the identity information before minting.');
      return;
    }

    const payload = {
      type: 'erc8004-agent-identity-submit',
      form,
      identityMetadata,
      nextSteps: [
        'Upload or resolve the identity metadata URI if it is not provided yet.',
        'Call ERC-8004 IdentityRegistry.register(metadataURI).',
        'Store the minted tokenId as the agentId.',
        'Configure worker/evaluator/client bot runtime separately from the identity registration flow.',
      ],
    };

    localStorage.setItem('arclayer-erc8004-agent-identity-submit', JSON.stringify(payload, null, 2));
    console.log('[ArcLayer] ERC-8004 agent identity payload:', payload);
    setNotice('Identity mint payload created. Wire this button to metadata upload and ERC-8004 register(metadataURI).');
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
              ERC-8004 · AGENT IDENTITY
            </div>
            <h1 className="mt-3 text-[34px] font-bold tracking-[-0.055em] text-[#F5F0E5] sm:text-[38px]">
              Register Agent Identity
            </h1>
            <p className="mt-5 max-w-[370px] text-[16px] leading-8 text-[#EAE4D8]/62">
              Mint an agent identity for ERC-8183 escrow commerce. Bot runtime settings are configured separately in the example bot flow.
            </p>
          </div>

          <div className="relative mt-16">
            <div className="absolute left-5 top-10 h-[140px] border-l border-dashed border-white/16" />
            <StepItem number={1} title="Identity" description="Name, role, category, and capabilities" active />
            <StepItem number={2} title="Ownership" description="Controller wallet and metadata URI" />
            <StepItem number={3} title="Mint" description="Review identity metadata and mint" />
          </div>

          <div className="mt-12 rounded-md border border-[#F3C536]/22 bg-[#F3C536]/[0.025] p-7">
            <div className="flex items-center gap-3 text-[#F3C536]">
              <Workflow className="h-5 w-5" />
              <div className="font-mono text-[13px] font-semibold">Identity only</div>
            </div>

            <div className="mt-8 space-y-8">
              <div className="flex gap-5">
                <BriefcaseBusiness className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">No bot settings here</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    Runtime URL, budgets, job templates, and automation strategy belong in the separate bot setup.
                  </p>
                </div>
              </div>

              <div className="flex gap-5">
                <Wallet className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Controller wallet owns identity</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    The controller address should be the wallet that owns or controls the ERC-8004 identity.
                  </p>
                </div>
              </div>

              <div className="flex gap-5">
                <Shield className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Job creation stays in Jobs</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    Manual clients create escrow jobs from Jobs. Autonomous clients use bot config after identity mint.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="px-5 py-8 sm:px-8 lg:px-14 xl:px-16">
          <div className="mx-auto max-w-[1180px] space-y-3">
            <Section icon={<Bot className="h-6 w-6" />} title="Agent Identity">
              <div className="grid gap-7 lg:grid-cols-2">
                <FieldShell label="Agent / Runtime Name" required helper="Human-readable name for the ERC-8004 identity.">
                  <TextInput
                    value={form.agentName}
                    onChange={(value) => update('agentName', value)}
                    placeholder="e.g., Smart Contract Audit Worker"
                  />
                </FieldShell>

                <FieldShell label="Role" required helper="Role stored in identity metadata for discovery.">
                  <SelectInput
                    value={form.role}
                    onChange={(value) => update('role', value as AgentRole)}
                    options={[
                      { value: 'worker', label: 'Worker — receives and submits escrow jobs' },
                      { value: 'evaluator', label: 'Evaluator — reviews and settles escrow jobs' },
                      { value: 'autonomous-client', label: 'Autonomous Client — identity for client bot' },
                    ]}
                  />
                </FieldShell>

                <div className="lg:col-span-2">
                  <div className="mb-3 font-mono text-[12px] font-semibold tracking-[-0.02em] text-[#F5F0E5]">
                    Identity Role <span className="text-[#F3C536]">*</span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <RoleButton role={ROLE_CONFIG.worker} active={form.role === 'worker'} onClick={() => update('role', 'worker')} />
                    <RoleButton role={ROLE_CONFIG.evaluator} active={form.role === 'evaluator'} onClick={() => update('role', 'evaluator')} />
                    <RoleButton role={ROLE_CONFIG['autonomous-client']} active={form.role === 'autonomous-client'} onClick={() => update('role', 'autonomous-client')} />
                  </div>
                </div>

                <FieldShell label="Category" required helper="Used for agent discovery and marketplace filtering.">
                  <SelectInput
                    value={form.category}
                    onChange={(value) => update('category', value as Category | '')}
                    options={[
                      { value: '', label: 'Select a category' },
                      ...CATEGORIES.map((category) => ({ value: category, label: category })),
                    ]}
                  />
                </FieldShell>

                <FieldShell label="Capabilities" required helper="Comma-separated identity tags, not bot strategy.">
                  <TextInput
                    value={form.capabilities}
                    onChange={(value) => update('capabilities', value)}
                    placeholder="audit, security-review, code-review"
                  />
                </FieldShell>

                {customCaps.length > 0 && (
                  <div className="lg:col-span-2 flex flex-wrap gap-2">
                    {customCaps.map((capability) => (
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
            </Section>

            <Section icon={<KeyRound className="h-6 w-6" />} title="Ownership">
              <div className="grid gap-7 lg:grid-cols-2">
                <FieldShell label="Controller Wallet" required helper="Public address that owns or controls this ERC-8004 identity.">
                  <TextInput
                    value={form.controllerWallet}
                    onChange={(value) => update('controllerWallet', value)}
                    placeholder="0x..."
                  />
                </FieldShell>

                <FieldShell label="Metadata URI" helper="Optional for now. The mint flow can upload metadata and fill this later.">
                  <TextInput
                    value={form.metadataUri}
                    onChange={(value) => update('metadataUri', value)}
                    placeholder="ipfs://... or https://..."
                  />
                </FieldShell>
              </div>
            </Section>

            <Section icon={<FileJson className="h-6 w-6" />} title="Review & Mint">
              <div className="grid gap-8 xl:grid-cols-[1fr_430px]">
                <div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-3">
                      <ReviewRow label="Agent Name" value={form.agentName} />
                      <ReviewRow label="Role" value={role.title} />
                      <ReviewRow label="Category" value={form.category} />
                    </div>

                    <div className="space-y-3">
                      <ReviewRow label="Controller" value={shortAddress(form.controllerWallet)} />
                      <ReviewRow label="Metadata URI" value={form.metadataUri || 'Generated later'} />
                      <ReviewRow label="Capabilities" value={customCaps.join(', ')} />
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
                      I understand this page only prepares/mints an ERC-8004 identity. Runtime URL, API keys, budgets, deliverables, requirements, and autonomous bot settings are configured separately.
                    </span>
                  </label>
                </div>

                <div className="rounded-md border border-white/10 bg-[#05070A]">
                  <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                    <FileJson className="h-4 w-4 text-[#F3C536]" />
                    <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#F3C536]">
                      Identity Metadata Preview
                    </div>
                  </div>
                  <pre className="max-h-[640px] overflow-auto p-4 text-[11px] leading-5 text-[#EAE4D8]/62">
                    {JSON.stringify(identityMetadata, null, 2)}
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
                Save a local identity draft now. Bot setup will be handled by the separate example-bot configuration flow.
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
                  Mint Identity
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
