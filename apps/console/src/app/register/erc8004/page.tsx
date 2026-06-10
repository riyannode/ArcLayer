'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { waitForTransactionReceipt } from '@wagmi/core';
import { type Address, encodeFunctionData, parseGwei } from 'viem';
import { useSignMessage } from 'wagmi';
import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronUp,
  FileJson,
  KeyRound,
  Shield,
  Wallet,
  Workflow,
} from 'lucide-react';
import { buildRegisterAgentConfig, ERC8004_IDENTITY_REGISTRY_ABI, CONTRACTS } from '@arclayer/sdk';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useArcWrite } from '@/hooks/useArcWrite';
import { useCircleWallet } from '@/hooks/useCircleWallet';
import { extractERC8004MintedTokenIdFromReceipt } from '@/lib/contracts/erc8004';
import { config } from '@/lib/wagmi';
import type { AgentManifestV1 } from '@/lib/a2a/manifest/types';
import { buildAgentManifest } from '@/lib/agent-onboarding/manifest-builder';
import { getOnboardingRolePreset } from '@/lib/agent-onboarding/role-presets';
import { normalizePublicRole } from '@/lib/erc8183/role-config';

// Keep union broad for ROLE_CONFIG keys, but public UI only allows provider.
type AgentRole = 'provider' | 'evaluator' | 'autonomous-client';
type RegisterStatus = 'idle' | 'pending' | 'success' | 'error';
type SectionKey = 'identity' | 'profile' | 'review';
type SectionStatus = 'Complete' | 'Pending';

const CATEGORIES = [
  'Smart Contract',
  'Frontend',
  'Backend',
  'DevOps',
  'Design',
  'Data Research',
  'Documentation',
  'Analysis',
] as const;

type Category = (typeof CATEGORIES)[number];

type RoleConfig = {
  id: AgentRole;
  title: string;
  label: string;
  description: string;
  identityRole: string;
  manifestMode: 'buyer' | 'seller' | 'dual';
  defaultCapabilities: string[];
  jobAccepts: string[];
};

type FormState = {
  agentName: string;
  description: string;
  avatarUrl: string;
  role: AgentRole;
  category: Category | '';
  capabilities: string;
  controllerWallet: string;
  metadataUri: string;
  websiteUrl: string;
  docsUrl: string;
  repoUrl: string;
  xUrl: string;
  confirm: boolean;
};

const ROLE_CONFIG: Record<AgentRole, RoleConfig> = {
  provider: {
    id: 'provider',
    title: 'Provider Agent',
    label: 'Provider',
    description: 'Performs ERC-8183 work, sets budget, and submits deliverables.',
    identityRole: 'provider',
    manifestMode: 'seller',
    defaultCapabilities: ['claim_job', 'submit_work'],
    jobAccepts: ['claim', 'run', 'submit-proof'],
  },
  evaluator: {
    id: 'evaluator',
    title: 'Evaluator Agent',
    label: 'Evaluator',
    description: 'Reviews work and settles escrow jobs.',
    identityRole: 'evaluator',
    manifestMode: 'dual',
    defaultCapabilities: ['evaluate_work', 'complete_job'],
    jobAccepts: ['run', 'submit-proof', 'complete'],
  },
  'autonomous-client': {
    id: 'autonomous-client',
    title: 'Client Agent',
    label: 'Client',
    description: 'Creates and funds escrow jobs.',
    identityRole: 'client',
    manifestMode: 'buyer',
    defaultCapabilities: ['create_job', 'fund_escrow'],
    jobAccepts: ['create'],
  },
};

const DEFAULT_FORM: FormState = {
  agentName: '',
  description: '',
  avatarUrl: '',
  role: 'provider',
  category: '',
  capabilities: '',
  controllerWallet: '',
  metadataUri: '',
  websiteUrl: '',
  docsUrl: '',
  repoUrl: '',
  xUrl: '',
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
        {label}
      </div>
      {children}
      <p className="mt-2 h-5 text-[12px] leading-5 text-[#EAE4D8]/48">{helper || ''}</p>
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
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={3}
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
  number,
  icon,
  title,
  subtitle,
  status,
  open,
  onToggle,
  children,
}: {
  number: number;
  icon: ReactNode;
  title: string;
  subtitle: string;
  status: SectionStatus;
  open: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#07090D]/88 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-5 px-7 py-5 text-left transition hover:bg-white/[0.025]"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#F3C536]/35 bg-[#05070A] text-[#F3C536]">
            {number}
          </div>

          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center text-[#F5F0E5]">
                {icon}
              </div>
              <h2 className="text-[20px] font-semibold tracking-[-0.04em] text-[#F5F0E5]">
                {title}
              </h2>
            </div>

            <p className="mt-2 text-[13px] leading-5 text-[#EAE4D8]/50">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span
            className={
              status === 'Complete'
                ? 'rounded-md border border-[#B8CD7E]/20 bg-[#B8CD7E]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#B8CD7E]'
                : 'rounded-md border border-[#F3C536]/20 bg-[#F3C536]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F3C536]'
            }
          >
            {status}
          </span>

          {open ? (
            <ChevronUp className="h-4 w-4 text-[#F3C536]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[#F3C536]" />
          )}
        </div>
      </button>

      {open ? (
        <div className="border-t border-white/10 px-7 pb-6 pt-5">
          {children}
        </div>
      ) : null}
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
    <div className="grid grid-cols-[135px_1fr] gap-4 text-[13px]">
      <span className="text-[#EAE4D8]/55">{label}</span>
      <span className="min-w-0 truncate text-[#F5F0E5]/85">{value || '—'}</span>
    </div>
  );
}

function RoleButton({
  role,
  active,
  disabled,
  badge,
  onClick,
}: {
  role: RoleConfig;
  active: boolean;
  disabled?: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        disabled
          ? 'cursor-not-allowed rounded-md border border-white/10 bg-white/[0.01] p-4 text-left opacity-50'
          : active
            ? 'rounded-md border border-[#F3C536]/45 bg-[#F3C536]/10 p-4 text-left transition'
            : 'rounded-md border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-[#F3C536]/30 hover:bg-[#F3C536]/[0.04]'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className={active ? 'font-semibold text-[#F3C536]' : disabled ? 'font-semibold text-[#EAE4D8]/40' : 'font-semibold text-[#F5F0E5]'}>
              {role.title}
            </div>
            {badge && (
              <span className="rounded border border-[#F3C536]/20 bg-[#F3C536]/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[#F3C536]/70">
                {badge}
              </span>
            )}
          </div>
          <p className={disabled ? 'mt-2 text-[12px] leading-5 text-[#EAE4D8]/30' : 'mt-2 text-[12px] leading-5 text-[#EAE4D8]/55'}>
            {role.description}
          </p>
        </div>
        {!disabled && (
          <div
            className={
              active
                ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[#F3C536] bg-[#F3C536] text-[#07090D]'
                : 'h-6 w-6 shrink-0 rounded border border-white/20'
            }
          >
            {active && <Check className="h-4 w-4" />}
          </div>
        )}
      </div>
    </button>
  );
}

function StatusBox({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.025] px-3 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#EAE4D8]/38">{label}</div>
      <div className={active ? 'mt-1 text-[12px] text-[#F3C536]' : 'mt-1 text-[12px] text-[#EAE4D8]/70'}>{value}</div>
    </div>
  );
}

function MetadataPreview({ data, manifestCount }: { data: unknown; manifestCount: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const json = useMemo(() => JSON.stringify(data, null, 2), [data]);

  return (
    <div className="rounded-md border border-white/10 bg-[#05070A]">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-white/[0.025]"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <FileJson className="h-4 w-4 text-[#F3C536]" />
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#F3C536]">
              Identity Metadata Preview
            </div>
            <div className="mt-1 text-[12px] text-[#EAE4D8]/50">{isOpen ? 'Hide JSON' : 'Show JSON'}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded border border-[#F3C536]/25 bg-[#F3C536]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F3C536]">
            {manifestCount} manifest
          </span>
          {isOpen ? <ChevronUp className="h-4 w-4 text-[#F3C536]" /> : <ChevronDown className="h-4 w-4 text-[#F3C536]" />}
        </div>
      </button>

      <div className="grid gap-2 border-t border-white/10 px-4 py-3 sm:grid-cols-3">
        <StatusBox label="Schema" value="arclayer.agent/v1" active />
        <StatusBox label="Category" value="erc8183-commerce" />
        <StatusBox label="Network" value="arc-testnet" />
      </div>

      {isOpen && (
        <pre className="max-h-[420px] overflow-auto border-t border-white/10 p-4 text-[11px] leading-5 text-[#EAE4D8]/62">
          {json}
        </pre>
      )}
    </div>
  );
}

function RegisterApiKeyCard({
  agentId,
  address,
  signMessageAsync,
}: {
  agentId: string;
  address: string | undefined;
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>;
}) {
  const [creating, setCreating] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      // Ensure wallet session cookie exists before calling authenticated endpoint
      if (!address) {
        setError('Connect wallet first');
        setCreating(false);
        return;
      }
      const { ensureWalletSession } = await import('@/lib/auth/ensureWalletSession');
      const sessionResult = await ensureWalletSession(address, signMessageAsync);
      if (!sessionResult.ok) {
        setError(sessionResult.error);
        setCreating(false);
        return;
      }
      const res = await fetch(`/api/agents/${agentId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: 'provider', label: 'PM2 Provider Key' }),
      });
      const data = await res.json();
      if (data.ok && data.key) {
        setRawKey(data.key);
      } else {
        setError(data.detail || data.error || 'Failed to create key');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setCreating(false);
    }
  };

  const copyKey = async () => {
    if (!rawKey) return;
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const envSnippet = `ARCLAYER_API_KEY=${rawKey ?? 'ak_...'}
ARCLAYER_AGENT_ID=${agentId}
ARCLAYER_BASE_URL=https://arclayers.xyz
ARCLAYER_MODE=provider`;

  const copyEnv = async () => {
    await navigator.clipboard.writeText(envSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
        API Key
      </div>
      <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[#F5F0E5]">
        Create API Key for this Agent
      </h3>
      <p className="mt-1 text-[13px] leading-5 text-[#EAE4D8]/50">
        Optional. Use this key to authenticate your PM2 provider bot with ArcLayer.
      </p>

      {!rawKey && !error && (
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="mt-4 h-12 rounded-md border border-[#F3C536]/35 bg-transparent px-8 text-[13px] font-semibold text-[#F3C536] transition hover:border-[#F3C536]/70 hover:bg-[#F3C536]/8 disabled:opacity-50"
        >
          {creating ? 'Signing...' : 'Create API Key'}
        </button>
      )}

      {error && (
        <p className="mt-3 text-[13px] text-rose-300">{error}</p>
      )}

      {rawKey && (
        <div className="mt-4 space-y-3">
          <div className="rounded-md border border-[#F3C536]/25 bg-[#F3C536]/[0.045] px-5 py-4 text-[13px] leading-6 text-[#F3C536]">
            Copy this key now. You will not be able to view it again.
          </div>

          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-white/10 bg-white/[0.025] px-3 py-2.5 font-mono text-[11px] text-[#F3C536]">
              {rawKey}
            </code>
            <button
              type="button"
              onClick={copyKey}
              className="h-12 shrink-0 rounded-md border border-[#F3C536]/35 bg-transparent px-5 text-[12px] font-semibold text-[#F3C536] transition hover:bg-[#F3C536]/8"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>

          <div className="relative">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#EAE4D8]/45">
                .env snippet
              </span>
              <button
                type="button"
                onClick={copyEnv}
                className="font-mono text-[10px] text-[#F3C536] hover:text-[#FFE070]"
              >
                Copy .env
              </button>
            </div>
            <pre className="mt-1 overflow-auto rounded-md border border-white/10 bg-white/[0.025] p-3 font-mono text-[10px] leading-5 text-[#EAE4D8]/65">
              {envSnippet}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ERC8183EscrowRegisterPage() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [notice, setNotice] = useState('');
  const [createdAt] = useState(() => new Date().toISOString());
  const [registerStatus, setRegisterStatus] = useState<RegisterStatus>('idle');
  const [mintedAgentId, setMintedAgentId] = useState<string>('');
  const [txHash, setTxHash] = useState<string>('');
  const [metadataDraftId, setMetadataDraftId] = useState('');
  const [metadataWriteToken, setMetadataWriteToken] = useState('');
  const [mcpIntentId, setMcpIntentId] = useState('');
  const [mcpRolePresetId, setMcpRolePresetId] = useState('');
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    identity: true,
    profile: false,
    review: false,
  });
  const [agentAccount, setAgentAccount] = useState<{ agentAccountAddress: string; status: string } | null>(null);
  const [agentAccountLoading, setAgentAccountLoading] = useState(true);
  const agentAccountEnabled = process.env.NEXT_PUBLIC_AGENT_ACCOUNT_ENABLED === 'true';
  const [controllerMode, setControllerMode] = useState<'eoa' | 'agent-account'>('eoa');
  const { isConnected, address } = useArcWallet();
  const { writeContractAsync } = useArcWrite();
  const { authenticated: circleAuthenticated, login: circleLogin, address: circleAddress, bundlerClient } = useCircleWallet();
  const { signMessageAsync } = useSignMessage();

  // Fetch Agent Account — re-fetches when wallet connects (needs session cookie)
  const fetchAgentAccount = useMemo(() => {
    return async function loadAgentAccount(addr?: string) {
      try {
        const res = await fetch('/api/profile/agent-account', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json.agentAccountAddress && json.status === 'active') {
            setAgentAccount({ agentAccountAddress: json.agentAccountAddress, status: json.status });
          } else {
            setAgentAccount(null);
          }
        } else if (res.status === 401 && addr) {
          // 401 = no session cookie. Ensure wallet session then retry.
          const { ensureWalletSession } = await import('@/lib/auth/ensureWalletSession');
          const sessionOk = await ensureWalletSession(addr, signMessageAsync);
          if (sessionOk.ok) {
            const retry = await fetch('/api/profile/agent-account', { cache: 'no-store' });
            if (retry.ok) {
              const json = await retry.json();
              if (json.agentAccountAddress && json.status === 'active') {
                setAgentAccount({ agentAccountAddress: json.agentAccountAddress, status: json.status });
              }
            }
          }
        }
      } catch {
        // silent
      } finally {
        setAgentAccountLoading(false);
      }
    };
  }, [signMessageAsync]);

  // Fetch on mount only when optional Agent Account mode is enabled.
  useEffect(() => {
    if (!agentAccountEnabled) {
      setAgentAccountLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      await fetchAgentAccount();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [agentAccountEnabled, fetchAgentAccount]);

  // Re-fetch when wallet connects (session cookie becomes available)
  useEffect(() => {
    if (!agentAccountEnabled || !address || !isConnected) return;
    // Only re-fetch if we haven't found an agent account yet
    if (agentAccount) return;
    setAgentAccountLoading(true);
    fetchAgentAccount(address);
  }, [address, isConnected, agentAccount, agentAccountEnabled, fetchAgentAccount]);

  // Read ?role= from URL on mount (supports deep-link from onboarding page)
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('role');
    if (param) {
      const key = normalizePublicRole(param);
      const effectiveRole: AgentRole = key === 'client' ? 'autonomous-client' : key === 'evaluator' ? 'evaluator' : 'provider';
      setForm((prev) => (prev.role === effectiveRole ? prev : { ...prev, role: effectiveRole, category: '', capabilities: '' }));
    }
  }, []);


  // Hydrate the existing form from an MCP registration intent when present.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const intent = params.get('intent');
    const isMcp = params.get('mcp') === '1';
    if (!intent || !isMcp || !address) return;

    let cancelled = false;
    (async () => {
      try {
        const { ensureWalletSession } = await import('@/lib/auth/ensureWalletSession');
        const sessionResult = await ensureWalletSession(address, signMessageAsync);
        if (!sessionResult.ok) {
          setNotice(sessionResult.error);
          return;
        }
        const res = await fetch(`/api/agent-onboarding/intents/${encodeURIComponent(intent)}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load MCP registration intent');
        if (cancelled) return;

        const metadata = json.draft?.metadata || {};
        const roleId = String(metadata.roles?.[0]?.id || json.intent?.rolePresetId || metadata.role || 'provider');
        const preset = getOnboardingRolePreset(roleId, { includeDisabled: true });
        const resolvedPresetId = preset?.id || 'provider';
        const effectiveRole: AgentRole = preset?.identityRole === 'client' ? 'autonomous-client' : preset?.identityRole === 'evaluator' ? 'evaluator' : 'provider';
        const category = CATEGORIES.find((item) => slugify(item) === preset?.category) || '';

        setMcpIntentId(intent);
        setMcpRolePresetId(resolvedPresetId);
        setMetadataDraftId(String(json.draft.draftId || ''));
        setMetadataWriteToken('');
        setForm((prev) => ({
          ...prev,
          agentName: typeof metadata.name === 'string' ? metadata.name : prev.agentName,
          description: typeof metadata.description === 'string' ? metadata.description : prev.description,
          avatarUrl: typeof metadata.avatar === 'string' ? metadata.avatar : prev.avatarUrl,
          role: effectiveRole,
          category,
          capabilities: Array.isArray(metadata.capabilities) ? metadata.capabilities.filter((cap: unknown) => typeof cap === 'string').join(', ') : prev.capabilities,
          controllerWallet: address,
          metadataUri: String(json.draft.metadataURI || ''),
          websiteUrl: typeof metadata.links?.homepage === 'string' ? metadata.links.homepage : prev.websiteUrl,
          docsUrl: typeof metadata.links?.docs === 'string' ? metadata.links.docs : prev.docsUrl,
          repoUrl: typeof metadata.links?.repo === 'string' ? metadata.links.repo : prev.repoUrl,
          xUrl: typeof metadata.links?.x === 'string' ? metadata.links.x : prev.xUrl,
        }));
        setNotice('MCP registration draft loaded. Review and mint with your wallet.');
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : 'Failed to load MCP registration intent.');
      }
    })();

    return () => { cancelled = true; };
  }, [address, signMessageAsync]);

  const role = ROLE_CONFIG[form.role];
  const customCaps = useMemo(() => capabilityList(form.capabilities), [form.capabilities]);
  const isClientRole = form.role === 'autonomous-client';
  const requiresCategoryAndCapabilities = !isClientRole;

  // Controller: connected EOA by default; passkey Agent Account is optional.
  const agentAccountAddress = agentAccount?.agentAccountAddress || '';
  const hasAgentAccount = Boolean(agentAccountAddress);
  const controller = controllerMode === 'eoa'
    ? (address || form.controllerWallet)
    : agentAccountAddress;
  const agentSlug = slugify(form.agentName) || 'erc8183-agent';
  const metadataURI = form.metadataUri.trim();
  const hasMcpIntent = Boolean(mcpIntentId);
  const hasRequiredCategory = hasMcpIntent || !requiresCategoryAndCapabilities || Boolean(form.category);
  const hasRequiredCapabilities = hasMcpIntent || !requiresCategoryAndCapabilities || customCaps.length > 0;

  const metadataReady = Boolean(
    form.agentName.trim() &&
      form.description.trim() &&
      hasRequiredCategory &&
      hasRequiredCapabilities &&
      controller,
  );

  const identityComplete = Boolean(
    form.agentName.trim() &&
      form.description.trim() &&
      hasRequiredCategory &&
      hasRequiredCapabilities,
  );
  const profileComplete = controllerMode === 'eoa' ? Boolean(controller) : hasAgentAccount;
  const reviewComplete = Boolean(metadataReady && form.confirm);

  // Keep the direct EOA controller field aligned with the connected wallet.
  useEffect(() => {
    if (!address || controllerMode !== 'eoa') return;
    setForm((prev) => (prev.controllerWallet ? prev : { ...prev, controllerWallet: address }));
  }, [address, controllerMode]);

  const agentManifest = useMemo(() => {
    const categorySlug = form.category
      ? slugify(form.category)
      : isClientRole
        ? 'client'
        : 'provider';
    const rolePresetId = mcpRolePresetId || (isClientRole ? 'client' : form.role === 'evaluator' ? 'evaluator' : categorySlug);

    return buildAgentManifest({
      agentId: mintedAgentId || `pending-${agentSlug}`,
      name: form.agentName || 'ArcLayer Agent',
      rolePresetId,
      description: form.description || `${role.title} for ERC-8183 escrow work orders.`,
      controller: controller || undefined,
      avatar: form.avatarUrl || undefined,
      customCapabilities: customCaps,
      links: {
        homepage: form.websiteUrl || undefined,
        docs: form.docsUrl || undefined,
        repo: form.repoUrl || undefined,
        x: form.xUrl || undefined,
      },
      createdAt,
      metadataURI: metadataURI || undefined,
    });
  }, [agentSlug, controller, createdAt, customCaps, form, isClientRole, metadataURI, mintedAgentId, role, mcpRolePresetId]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateRole(nextRole: AgentRole) {
    // Map internal role name to config key: 'autonomous-client' → 'client'
    const configKey = nextRole === 'autonomous-client' ? 'client' : nextRole;
    const publicKey = normalizePublicRole(configKey);
    const effectiveRole: AgentRole = publicKey === 'client' ? 'autonomous-client' : publicKey === 'evaluator' ? 'evaluator' : 'provider';

    setForm((prev) => {
      if (prev.role === effectiveRole) return prev;

      if (effectiveRole === 'autonomous-client') {
        return {
          ...prev,
          role: effectiveRole,
          category: '',
          capabilities: '',
        };
      }

      return {
        ...prev,
        role: effectiveRole,
      };
    });
  }

  function toggleSection(key: SectionKey) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function saveDraft() {
    const payload = {
      type: 'erc8183-agent-identity-draft',
      source: mcpIntentId ? 'mcp-onboarding' : 'web-register',
      mcpIntentId: mcpIntentId || undefined,
      mcpRolePresetId: mcpRolePresetId || undefined,
      form,
      metadataURI,
      agentManifest,
      metadataDraftId,
      metadataWriteToken,
    };

    localStorage.setItem('arclayer-erc8183-agent-identity-draft', JSON.stringify(payload, null, 2));
    setNotice('Draft saved. Bot setup is separate.');
  }

  async function createDraft(metadata: AgentManifestV1) {
    const res = await fetch('/api/a2a/metadata/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ controller, metadata }),
    });

    const json = await res.json();

    if (!res.ok || !json.ok) {
      throw new Error(json.error || 'Failed to create metadata draft');
    }

    setMetadataDraftId(json.draftId);
    setMetadataWriteToken(json.writeToken);
    update('metadataUri', json.metadataURI);

    return {
      draftId: json.draftId as string,
      writeToken: json.writeToken as string,
      metadataURI: json.metadataURI as string,
    };
  }

  async function patchDraft(input: {
    draftId: string;
    writeToken: string;
    agentId: string;
    txHash: string;
    metadata: AgentManifestV1;
  }) {
    const res = await fetch(`/api/a2a/metadata/draft/${input.draftId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        writeToken: input.writeToken,
        agentId: input.agentId,
        txHash: input.txHash,
        metadata: input.metadata,
      }),
    });

    const json = await res.json();

    if (!res.ok || !json.ok) {
      throw new Error(json.error || 'Failed to update metadata draft');
    }
  }

  async function submitRegister() {
    if (!isConnected || !address) {
      setRegisterStatus('error');
      setNotice('Connect wallet first.');
      return;
    }
    if (!metadataReady) {
      setRegisterStatus('error');
      setNotice('Complete required fields first.');
      return;
    }
    if (!form.confirm) {
      setRegisterStatus('error');
      setNotice('Confirm the identity information before minting.');
      return;
    }

    // Agent Account path: require passkey auth
    if (controllerMode === 'agent-account' && !hasAgentAccount) {
      setRegisterStatus('error');
      setNotice('Circle Agent Account is unavailable. Use EOA controller mode or link an account in Profile.');
      return;
    }

    // Agent Account path: prompt passkey login if not authenticated
    if (controllerMode === 'agent-account' && hasAgentAccount && !circleAuthenticated) {
      try {
        setNotice('Login with passkey to use Circle Agent Account...');
        await circleLogin();
        // After login, React state (bundlerClient/circleAddress) is stale in this render.
        // Stop and ask user to click Mint again — by then state will be updated.
        setRegisterStatus('idle');
        setNotice('Passkey login successful. Click Mint Identity again to continue.');
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message.toLowerCase() : '';
        const cancelled = msg.includes('cancel') || msg.includes('abort') || msg.includes('notallowed');
        if (cancelled) {
          setRegisterStatus('idle');
          setNotice('Passkey login cancelled.');
          return;
        }
        setRegisterStatus('error');
        setNotice('Passkey login failed. Try again or use EOA controller mode.');
        return;
      }
    }

    try {
      setRegisterStatus('pending');

      // Step 1: Create draft only if no user-provided metadataURI
      let draftId = metadataDraftId;
      let writeToken = metadataWriteToken;
      let effectiveMetadataURI = metadataURI;

      if (!effectiveMetadataURI && !draftId) {
        setNotice('Creating metadata draft...');
        const draft = await createDraft(agentManifest as AgentManifestV1);
        draftId = draft.draftId;
        writeToken = draft.writeToken;
        effectiveMetadataURI = draft.metadataURI;
      }

      if (!effectiveMetadataURI) {
        setRegisterStatus('error');
        setNotice('Metadata URI is required.');
        return;
      }

      // Step 2: Mint ERC-8004 identity
      let hash: `0x${string}`;

      if (controllerMode === 'eoa') {
        // Default path: connected EOA signs directly
        setNotice('Submitting ERC-8004 identity mint (EOA)...');
        hash = await writeContractAsync(buildRegisterAgentConfig(effectiveMetadataURI));
      } else {
        // Agent Account path: sign via Circle Smart Account (passkey)
        if (!bundlerClient) {
          setRegisterStatus('error');
          setNotice('Circle Agent Account not connected. Login with passkey first.');
          return;
        }

        // Verify Circle address matches expected Agent Account
        if (!circleAddress || circleAddress.toLowerCase() !== agentAccountAddress.toLowerCase()) {
          setRegisterStatus('error');
          setNotice('Agent Account mismatch. Re-login with passkey.');
          return;
        }

        setNotice('Submitting ERC-8004 identity mint via Circle Agent Account...');

        const calldata = encodeFunctionData({
          abi: ERC8004_IDENTITY_REGISTRY_ABI,
          functionName: 'register',
          args: [effectiveMetadataURI],
        });

        // Circle bundler requires maxPriorityFeePerGas >= 1 gwei.
        // Arc testnet fee estimation returns ~0.005 gwei which is too low.
        const userOpHash = await bundlerClient.sendUserOperation({
          calls: [
            {
              to: CONTRACTS.ERC8004_IDENTITY_REGISTRY as Address,
              data: calldata,
              value: BigInt(0),
            },
          ],
          maxPriorityFeePerGas: parseGwei('1'),
          maxFeePerGas: parseGwei('50'),
        });

        setNotice('Waiting for User Operation confirmation...');
        const userOpReceipt = await bundlerClient.waitForUserOperationReceipt({
          hash: userOpHash,
        });

        hash = userOpReceipt.receipt.transactionHash as `0x${string}`;
      }

      setTxHash(hash);
      setNotice(`Waiting for ${hash.slice(0, 10)}...`);

      const receipt = await waitForTransactionReceipt(config, { hash });
      const minted = extractERC8004MintedTokenIdFromReceipt(receipt, (controllerMode === 'eoa' ? address : agentAccountAddress) as Address | undefined);
      const mintedId = minted.toString();

      // Step 3: Patch draft with minted agentId
      const finalRolePresetId = mcpRolePresetId || (isClientRole ? 'client' : form.role === 'evaluator' ? 'evaluator' : (form.category ? slugify(form.category) : 'provider'));
      const finalManifest = buildAgentManifest({
        agentId: mintedId,
        name: form.agentName || agentManifest.name,
        rolePresetId: finalRolePresetId,
        description: form.description || agentManifest.description,
        controller: controller || undefined,
        avatar: form.avatarUrl || undefined,
        customCapabilities: customCaps,
        links: {
          homepage: form.websiteUrl || undefined,
          docs: form.docsUrl || undefined,
          repo: form.repoUrl || undefined,
          x: form.xUrl || undefined,
        },
        createdAt,
        metadataURI: effectiveMetadataURI,
        updatedAt: new Date().toISOString(),
      });

      if (mcpIntentId) {
        setNotice('Finalizing MCP registration intent...');
        const finalize = await fetch('/api/agent-onboarding/finalize', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ intentId: mcpIntentId, agentId: mintedId, txHash: hash, manifest: finalManifest }),
        });
        const finalizeJson = await finalize.json();
        if (!finalize.ok || !finalizeJson.ok) {
          throw new Error(finalizeJson.error || 'Failed to finalize MCP registration intent');
        }
      } else if (draftId && writeToken) {
        setNotice('Updating metadata draft...');
        await patchDraft({
          draftId,
          writeToken,
          agentId: mintedId,
          txHash: hash,
          metadata: finalManifest,
        });
      }

      setMintedAgentId(mintedId);
      setRegisterStatus('success');

      localStorage.setItem(
        'arclayer-erc8183-agent-identity-registered',
        JSON.stringify(
          {
            agentId: mintedId,
            txHash: hash,
            source: mcpIntentId ? 'mcp-onboarding' : 'web-register',
            mcpIntentId: mcpIntentId || undefined,
            mcpRolePresetId: mcpRolePresetId || undefined,
            metadataURI: effectiveMetadataURI,
            form,
            agentManifest: finalManifest,
            nextStep: 'Identity minted. Set up agent operation in Agent Setup.',
          },
          null,
          2,
        ),
      );

      setNotice(`Identity minted. Agent ID ${mintedId}. Manifest draft updated.`);
    } catch (error) {
      setRegisterStatus('error');
      setNotice(error instanceof Error ? error.message : 'Identity mint failed.');
    }
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
              ERC-8004
            </div>
            <h1 className="mt-3 text-[34px] font-bold tracking-[-0.055em] text-[#F5F0E5] sm:text-[38px]">
              Register Agent Identity
            </h1>
            <p className="mt-5 max-w-[370px] text-[16px] leading-8 text-[#EAE4D8]/62">
              Create the public identity first. PM2 bot setup comes later.
            </p>
          </div>

          <div className="relative mt-16">
            <div className="absolute left-5 top-10 h-[140px] border-l border-dashed border-white/16" />
            <StepItem number={1} title="Identity" description="Name, role, category" active />
            <StepItem number={2} title="Profile" description="Avatar, links, metadata" />
            <StepItem number={3} title="Mint" description="Review and register" />
          </div>

          <div className="mt-12 rounded-md border border-[#F3C536]/22 bg-[#F3C536]/[0.025] p-7">
            <div className="flex items-center gap-3 text-[#F3C536]">
              <Workflow className="h-5 w-5" />
              <div className="font-mono text-[13px] font-semibold">Simple scope</div>
            </div>

            <div className="mt-8 space-y-8">
              <div className="flex gap-5">
                <BriefcaseBusiness className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Identity only</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    No PM2, keys, or private config here.
                  </p>
                </div>
              </div>

              <div className="flex gap-5">
                <Wallet className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Bot EOA controls identity</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    The connected EOA is the default controller. Circle Agent Account is optional for passkey-based identity control.
                  </p>
                </div>
              </div>

              <div className="flex gap-5">
                <Shield className="mt-1 h-6 w-6 shrink-0 text-[#F3C536]" />
                <div>
                  <div className="font-semibold text-[#F5F0E5]">Next step</div>
                  <p className="mt-1 text-[13px] leading-6 text-[#EAE4D8]/62">
                    Identity minted. Next, set up how this agent will operate.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="px-5 py-8 sm:px-8 lg:px-14 xl:px-16">
          <div className="mx-auto max-w-[1180px] space-y-3">
            <Section
              number={1}
              icon={<Bot className="h-6 w-6" />}
              title="Agent Identity"
              subtitle="Name, role, category, and public capabilities."
              status={identityComplete ? 'Complete' : 'Pending'}
              open={openSections.identity}
              onToggle={() => toggleSection('identity')}
            >
              <div className="grid gap-7 lg:grid-cols-2">
                <FieldShell label="Agent Name" required>
                  <TextInput
                    value={form.agentName}
                    onChange={(value) => update('agentName', value)}
                    placeholder="e.g., Smart Contract Audit Worker"
                  />
                </FieldShell>

                <FieldShell label="Role" required>
                  <SelectInput
                    value={form.role}
                    onChange={(value) => updateRole(value as AgentRole)}
                    options={[
                      { value: 'provider', label: 'Provider (Receive Job)' },
                      { value: 'evaluator', label: 'Evaluator (Coming soon)' },
                    ]}
                  />
                  <p className="mt-2 text-[11px] text-[#EAE4D8]/40">
                    Provider registration is available. Evaluator automation is being staged internally.
                  </p>
                </FieldShell>

                <div className="lg:col-span-2">
                  <div className="mb-3 font-mono text-[12px] font-semibold tracking-[-0.02em] text-[#F5F0E5]">
                    Identity Role
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <RoleButton
                      role={ROLE_CONFIG.provider}
                      active={form.role === 'provider'}
                      badge="Available"
                      onClick={() => updateRole('provider')}
                    />

                    <RoleButton
                      role={ROLE_CONFIG.evaluator}
                      active={form.role === 'evaluator'}
                      disabled
                      badge="Coming soon"
                      onClick={() => {}}
                    />
                  </div>
                </div>

                <div className="lg:col-span-2">
                  <FieldShell label="Description" required>
                    <TextareaInput
                      value={form.description}
                      onChange={(value) => update('description', value)}
                      placeholder="What does this escrow agent do?"
                    />
                  </FieldShell>
                </div>

                {requiresCategoryAndCapabilities && (
                  <>
                    <FieldShell label="Category" required>
                      <SelectInput
                        value={form.category}
                        onChange={(value) => update('category', value as Category | '')}
                        options={[
                          { value: '', label: 'Select a category' },
                          ...CATEGORIES.map((category) => ({ value: category, label: category })),
                        ]}
                      />
                    </FieldShell>

                    <FieldShell label="Capabilities" required>
                      <TextInput
                        value={form.capabilities}
                        onChange={(value) => update('capabilities', value)}
                        placeholder="audit, security-review, code-review"
                      />
                    </FieldShell>
                  </>
                )}

                {customCaps.length > 0 && (
                  <div className="lg:col-span-2 flex flex-wrap gap-2">
                    {customCaps.map((capability) => (
                      <span
                        key={capability}
                        className="rounded-md border border-white/10 bg-white/[0.035] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#EAE4D8]/63"
                      >
                        {capability}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Section>

            <Section
              number={2}
              icon={<KeyRound className="h-6 w-6" />}
              title="Profile & Ownership"
              subtitle="Controller wallet, metadata URI, avatar, and links."
              status={profileComplete ? 'Complete' : 'Pending'}
              open={openSections.profile}
              onToggle={() => toggleSection('profile')}
            >
              <div className="mb-6 rounded-lg border border-white/10 bg-[#07090D]/88 p-5">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#F3C536]">Controller mode</div>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button type="button" onClick={() => setControllerMode('eoa')} className={controllerMode === 'eoa' ? 'rounded-md border border-[#F3C536] bg-[#F3C536] px-4 py-2 text-[12px] font-semibold text-[#07090D]' : 'rounded-md border border-white/10 px-4 py-2 text-[12px] text-[#EAE4D8]/60'}>Bot EOA (default)</button>
                  {agentAccountEnabled && (
                    <button type="button" onClick={() => setControllerMode('agent-account')} disabled={agentAccountLoading || !hasAgentAccount} className={controllerMode === 'agent-account' ? 'rounded-md border border-[#F3C536] bg-[#F3C536] px-4 py-2 text-[12px] font-semibold text-[#07090D]' : 'rounded-md border border-white/10 px-4 py-2 text-[12px] text-[#EAE4D8]/60 disabled:cursor-not-allowed disabled:opacity-40'}>Circle Agent Account</button>
                  )}
                </div>
                <p className="mt-3 text-[12px] leading-5 text-[#EAE4D8]/55">{controllerMode === 'eoa' ? 'Bot EOA controls this identity.' : 'Circle Agent Account is optional for passkey-based identity control.'}</p>
              </div>

              <div className="grid gap-7 lg:grid-cols-2">
                <FieldShell label="Controller" required helper={controllerMode === 'eoa' ? 'Bot EOA controls this identity.' : 'Optional passkey-based identity controller'}>
                  {controllerMode === 'agent-account' ? (
                    <div className="flex h-12 items-center gap-2 rounded-md border border-[#F3C536]/20 bg-[#F3C536]/[0.04] px-4 text-[14px] text-[#F3C536]"><Shield className="h-4 w-4 shrink-0" /><span className="truncate font-mono text-[13px]">{agentAccountAddress}</span></div>
                  ) : isConnected && address ? (
                    <div className="flex h-12 items-center gap-2 rounded-md border border-[#B8CD7E]/20 bg-[#B8CD7E]/[0.04] px-4 text-[14px] text-[#B8CD7E]"><Wallet className="h-4 w-4 shrink-0" /><span className="truncate font-mono text-[13px]">{address}</span></div>
                  ) : (
                    <TextInput value={form.controllerWallet} onChange={(value) => update('controllerWallet', value)} placeholder="0x..." />
                  )}
                </FieldShell>

                <FieldShell label="Avatar / Logo URL">
                  <TextInput
                    value={form.avatarUrl}
                    onChange={(value) => update('avatarUrl', value)}
                    placeholder="https://.../logo.png"
                  />
                </FieldShell>

                <FieldShell label="Metadata URI">
                  <TextInput
                    value={form.metadataUri}
                    onChange={(value) => update('metadataUri', value)}
                    placeholder="Auto-generated (or paste your own https://... / ipfs://...)"
                  />
                </FieldShell>

                <FieldShell label="Website" helper="Optional">
                  <TextInput
                    value={form.websiteUrl}
                    onChange={(value) => update('websiteUrl', value)}
                    placeholder="https://..."
                  />
                </FieldShell>

                <FieldShell label="Docs" helper="Optional">
                  <TextInput
                    value={form.docsUrl}
                    onChange={(value) => update('docsUrl', value)}
                    placeholder="https://..."
                  />
                </FieldShell>

                <FieldShell label="Repo" helper="Optional">
                  <TextInput
                    value={form.repoUrl}
                    onChange={(value) => update('repoUrl', value)}
                    placeholder="https://github.com/..."
                  />
                </FieldShell>

                <FieldShell label="X / Twitter" helper="Optional">
                  <TextInput
                    value={form.xUrl}
                    onChange={(value) => update('xUrl', value)}
                    placeholder="https://x.com/..."
                  />
                </FieldShell>
              </div>

            </Section>

            <Section
              number={3}
              icon={<FileJson className="h-6 w-6" />}
              title="Review & Mint"
              subtitle="Check metadata, confirm ownership, then mint identity."
              status={reviewComplete ? 'Complete' : 'Pending'}
              open={openSections.review}
              onToggle={() => toggleSection('review')}
            >
              <div className="grid gap-8 xl:grid-cols-[1fr_430px]">
                <div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-3">
                      <ReviewRow label="Agent Name" value={form.agentName} />
                      <ReviewRow label="Role" value={role.title} />
                      <ReviewRow label="Category" value={form.category} />
                      <ReviewRow label="Agent ID" value={mintedAgentId || 'Pending identity'} />
                    </div>

                    <div className="space-y-3">
                      <ReviewRow label="Controller" value={controller ? `${controllerMode === 'eoa' ? 'EOA' : 'Agent Account'} ${shortAddress(controller)}` : 'Not set'} />
                      <ReviewRow label="Metadata URI" value={metadataURI || 'Auto-generated on register'} />
                      <ReviewRow label="Capabilities" value={customCaps.join(', ')} />
                      <ReviewRow label="Tx" value={txHash ? shortAddress(txHash) : '—'} />
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-4">
                    <StatusBox label="Identity" value={mintedAgentId ? `Agent ${mintedAgentId}` : 'Pending'} active={Boolean(mintedAgentId)} />
                    <StatusBox label="Metadata" value={metadataReady ? 'Ready' : 'Incomplete'} active={metadataReady} />
                    <StatusBox label="Controller" value={controller ? `${controllerMode === 'eoa' ? 'EOA' : 'AA'}: ${shortAddress(controller)}` : 'Not set'} active={Boolean(controller)} />
                    <StatusBox label="Next" value="Agent Setup" active={registerStatus === 'success'} />
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
                      I confirm this is public identity metadata. Bot secrets and PM2 settings are configured separately.
                    </span>
                  </label>
                </div>

                <MetadataPreview data={agentManifest} manifestCount={1} />
              </div>
            </Section>

            {notice && (
              <div
                className={
                  registerStatus === 'error'
                    ? 'rounded-md border border-rose-400/25 bg-rose-400/[0.055] px-5 py-4 text-[13px] leading-6 text-rose-200'
                    : 'rounded-md border border-[#F3C536]/25 bg-[#F3C536]/[0.045] px-5 py-4 text-[13px] leading-6 text-[#F3C536]'
                }
              >
                {notice}
                {registerStatus === 'success' && (
                  <div className="mt-2 text-[#EAE4D8]/70">
                    Identity minted. Next, set up how this agent will operate.
                  </div>
                )}
              </div>
            )}

            {registerStatus === 'success' && mintedAgentId && (
              <RegisterApiKeyCard agentId={mintedAgentId} address={address} signMessageAsync={signMessageAsync} />
            )}

            {registerStatus === 'success' && (
              <div className="flex flex-wrap gap-3">
                <a
                  href="/profile"
                  className="inline-flex h-12 items-center gap-3 rounded-md border border-[#F3C536]/45 bg-transparent px-8 text-[13px] font-semibold text-[#F3C536] transition hover:bg-[#F3C536]/10"
                >
                  Open Profile
                </a>
                <a
                  href="/agent-setup"
                  className="inline-flex h-12 items-center gap-3 rounded-md bg-[#F3C536] px-8 text-[13px] font-semibold text-[#07090D] transition hover:bg-[#FFE070]"
                >
                  Continue to Agent Setup
                </a>
              </div>
            )}

            <div className="sticky bottom-0 z-20 flex flex-col gap-4 rounded-t-xl border-t border-white/10 bg-[#05070A]/92 px-5 py-5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[13px] leading-6 text-[#EAE4D8]/55">
                {registerStatus === 'success'
                  ? 'Identity minted successfully. Continue to profile or agent setup.'
                  : 'Register identity here. Configure agents in the setup flow.'}
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
                  disabled={registerStatus === 'pending' || (controllerMode === 'agent-account' && !hasAgentAccount)}
                  className="h-12 rounded-md border border-[#F3C536] bg-[#F3C536] px-9 text-[13px] font-semibold text-[#07090D] transition hover:bg-[#FFE070] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {registerStatus === 'pending'
                    ? 'Minting...'
                    : controllerMode === 'eoa'
                      ? 'Mint Identity (EOA)'
                      : 'Mint Identity (Agent Account)'}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
