'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BadgeCheck,
  Bot,
  CheckCircle2,
  Clipboard,
  Code2,
  ExternalLink,
  FileJson,
  Globe,
  KeyRound,
  Link2,
  Loader2,
  Medal,
  Plus,
  RefreshCcw,
  ShieldCheck,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useCircleWallet } from '@/hooks/useCircleWallet';
import { useFundAgentAccount } from '@/hooks/useFundAgentAccount';
import { useGatewayDeposit } from '@/hooks/useGatewayDeposit';

// ── MCP Prompt Template data ─────────────────────────────────────────────

type ProviderAgentType = {
  key: string;
  label: string;
  name: string;
  capabilities: string;
  description: string;
};

const PROVIDER_AGENT_TYPES: ProviderAgentType[] = [
  { key: 'smart-contract', label: 'Smart Contract Agent', name: 'Solidity Audit Bot', capabilities: 'smart-contract, solidity-audit', description: 'I can review Solidity contracts and submit ERC-8183 job deliverables.' },
  { key: 'frontend', label: 'Frontend Agent', name: 'Frontend Implementation Bot', capabilities: 'frontend, react, ui-implementation', description: 'I can implement frontend tasks, build UI components, and submit ERC-8183 job deliverables.' },
  { key: 'backend', label: 'Backend Agent', name: 'Backend API Bot', capabilities: 'backend, api, database', description: 'I can build backend services, API routes, and database integrations for ERC-8183 job deliverables.' },
  { key: 'devops', label: 'DevOps Agent', name: 'DevOps Automation Bot', capabilities: 'devops, deployment, monitoring', description: 'I can handle deployment, monitoring, environment setup, and infrastructure tasks.' },
  { key: 'design', label: 'Design Agent', name: 'Product Design Bot', capabilities: 'design, ui-ux, product-design', description: 'I can create design reviews, UI structure, and product experience recommendations.' },
  { key: 'data-research', label: 'Data Research Agent', name: 'Data Research Bot', capabilities: 'research, data-analysis, market-data', description: 'I can research data, summarize findings, and submit structured deliverables.' },
  { key: 'documentation', label: 'Documentation Agent', name: 'Documentation Bot', capabilities: 'documentation, technical-writing', description: 'I can write docs, README updates, integration guides, and technical explanations.' },
  { key: 'analysis', label: 'Analysis Agent', name: 'Analysis Bot', capabilities: 'analysis, evaluation, reasoning', description: 'I can analyze requirements, review outputs, and produce structured reports.' },
  { key: 'payment', label: 'Payment Agent', name: 'Payment Integration Bot', capabilities: 'x402, payments, usdc', description: 'I can help with payment flows, x402 access, USDC settlement, and receipt workflows.' },
  { key: 'other', label: 'Other', name: 'Custom Provider Agent', capabilities: 'general, automation', description: 'I can perform general agentic tasks and submit structured job deliverables.' },
];

function buildProviderPrompt(agentType: ProviderAgentType): string {
  return [
    `Register me on ArcLayer as a provider.`,
    `Name: ${agentType.name}`,
    `Role: provider`,
    `Capabilities: ${agentType.capabilities}`,
    `Description: ${agentType.description}`,
    ``,
    `After the agent identity is minted, create a provider API key for this agent and return the .env snippet for my PM2 bot.`,
  ].join('\n');
}

const CLIENT_PROMPT = [
  `Register me on ArcLayer as a client.`,
  `Name: Job Creator Agent`,
  `Role: client`,
  `Capabilities: job-creation, escrow-funding`,
  `Description: I can create ERC-8183 jobs, fund work, and coordinate providers.`,
  ``,
  `After the agent identity is minted, prepare this agent for client-side job creation flows.`,
].join('\n');

function McpPromptCard() {
  const [mode, setMode] = useState<'provider' | 'client'>('provider');
  const [selectedType, setSelectedType] = useState<string>('smart-contract');
  const [copied, setCopied] = useState(false);

  const agentType = PROVIDER_AGENT_TYPES.find((t) => t.key === selectedType) || PROVIDER_AGENT_TYPES[0];
  const prompt = mode === 'provider' ? buildProviderPrompt(agentType) : CLIENT_PROMPT;

  async function handleCopy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-6 rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
        MCP Prompt Template
      </div>
      <p className="mt-2 text-[13px] leading-5 text-[#EAE4D8]/50">
        Choose an agent type and copy a Claude/Codex MCP prompt.
      </p>

      {/* Mode toggle */}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setMode('provider')}
          className={
            mode === 'provider'
              ? 'h-9 rounded-md border border-[#F3C536] bg-[#F3C536] px-4 text-[12px] font-semibold text-[#07090D] transition'
              : 'h-9 rounded-md border border-white/10 bg-transparent px-4 text-[12px] text-[#EAE4D8]/60 transition hover:border-[#F3C536]/40 hover:text-[#F3C536]'
          }
        >
          Provider Bot <span className="ml-1 text-[10px] opacity-70">Recommended</span>
        </button>
        <button
          type="button"
          onClick={() => setMode('client')}
          className={
            mode === 'client'
              ? 'h-9 rounded-md border border-[#F3C536] bg-[#F3C536] px-4 text-[12px] font-semibold text-[#07090D] transition'
              : 'h-9 rounded-md border border-white/10 bg-transparent px-4 text-[12px] text-[#EAE4D8]/60 transition hover:border-[#F3C536]/40 hover:text-[#F3C536]'
          }
        >
          Client Bot
        </button>
      </div>

      {/* Provider: Agent Type selector */}
      {mode === 'provider' && (
        <div className="mt-4">
          <label className="text-[11px] uppercase tracking-[0.14em] text-[#EAE4D8]/40">
            Agent Type
          </label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="mt-1.5 h-10 w-full rounded-md border border-white/10 bg-[#0A0D12] px-3 text-[13px] text-[#F5F0E5] outline-none focus:border-[#F3C536]/40"
          >
            {PROVIDER_AGENT_TYPES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Prompt box */}
      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.025] p-4">
        <pre className="whitespace-pre-wrap font-mono text-[11px] leading-5 text-[#EAE4D8]/65">
          {prompt}
        </pre>
      </div>

      {/* Copy button */}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleCopy}
          className="h-10 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070]"
        >
          {copied ? 'Copied ✓' : 'Copy Prompt'}
        </button>
        <span className="text-[11px] text-[#EAE4D8]/35">
          Paste into Claude or Codex with the ArcLayer MCP configured.
        </span>
      </div>
    </div>
  );
}

// ── Agent Account types ───────────────────────────────────────────────────

type AgentAccountInfo = {
  ownerAddress: string;
  agentAccountAddress: string | null;
  status: string;
  chainId: number;
};

type BalanceInfo = {
  raw: string;
  formatted: string;
};

type AgentMetadata = {
  schema?: string;
  version?: number;
  agentId?: string;
  name?: string;
  role?: string;
  description?: string;
  controller?: string;
  mode?: string;
  avatar?: string;
  capability?: string[];
  capabilities?: string[];
  categories?: string[];
  tags?: string[];
  metadataURI?: string;
  txHash?: string;
  updatedAt?: string;
  links?: {
    homepage?: string;
    website?: string;
    docs?: string;
    repo?: string;
    x?: string;
    twitter?: string;
  };
};

type ProfileAgent = {
  agentId: string;
  controller: string;
  status: 'minted' | string;
  txHash?: string;
  metadata: AgentMetadata;
  updatedAt?: string;
  /** Which wallet controls this agent: EOA (legacy) or Agent Account (Circle) */
  source?: 'eoa' | 'agent_account';
};

type ProfileResponse = {
  ok: boolean;
  controller: string;
  agents: ProfileAgent[];
  total: number;
  error?: string;
};

type ReputationFeedback = {
  score?: string;
  reviewer?: string;
  comment?: string;
  metadataURI?: string;
  proofURI?: string;
  context?: string;
  ref?: string;
  blockNumber?: string;
  txHash?: string;
  logIndex?: number;
  source?: string;
};

type ReputationResponse = {
  ok: boolean;
  agentId: string;
  tokenId?: string;
  score?: string;
  feedback?: ReputationFeedback[];
  source?: string;
  updatedAt?: string | null;
  error?: string;
  reputation?: {
    score?: string;
    feedback?: ReputationFeedback[];
    source?: string;
    updatedAt?: string | null;
  };
};

type TabKey = 'basic' | 'capabilities' | 'links' | 'reputation' | 'metadata';

const EMPTY_AGENTS: ProfileAgent[] = [];

/** Map raw passkey/Circle errors to user-friendly copy. */
function mapPasskeyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  // WebAuthn credential creation failed on non-production origin
  if (lower.includes('credentials') || lower.includes('credential')) {
    return 'Passkey credential creation failed. Try using arclayers.xyz, a new passkey name, or clear existing passkeys for this site.';
  }
  // User cancelled the passkey prompt
  if (lower.includes('cancel') || lower.includes('abort') || lower.includes('notallowed')) {
    return ''; // silent — user action, not an error
  }
  // WebAuthn not supported
  if (lower.includes('not supported') || lower.includes('notavailable')) {
    return 'WebAuthn is not supported on this browser. Try Chrome or Safari on a device with biometrics.';
  }
  // Network / RPC errors
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('timeout')) {
    return 'Network error. Check your connection and try again.';
  }
  // Fallback — show sanitized message
  return raw.length > 200 ? raw.slice(0, 200) + '…' : raw || 'Passkey registration failed.';
}

function shortAddress(value?: string) {
  if (!value) return '—';
  if (value.length < 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function roleLabel(value?: string) {
  if (!value) return 'Worker';
  if (value === 'provider') return 'Worker';
  if (value === 'autonomous-client') return 'Client';
  return value
    .split(/[-_ ]+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function uniq(values: Array<string | undefined>) {
  return Array.from(
    new Set(
      values
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );
}

function getAgentName(agent: ProfileAgent) {
  return agent.metadata?.name || `Agent ${agent.agentId}`;
}

function getCapabilities(agent: ProfileAgent) {
  return uniq([
    ...(agent.metadata?.capabilities || []),
    ...(agent.metadata?.capability || []),
    ...(agent.metadata?.tags || []),
  ]).slice(0, 12);
}

function getMetadataURI(agent: ProfileAgent) {
  return agent.metadata?.metadataURI || '';
}

function getLinks(agent: ProfileAgent) {
  const links = agent.metadata?.links || {};
  return {
    website: links.homepage || links.website || '',
    docs: links.docs || '',
    repo: links.repo || '',
    x: links.x || links.twitter || '',
  };
}

async function copyToClipboard(value?: string) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
}

function ProfileIcon({ className = '' }: { className?: string }) {
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-full border border-[#F3C536]/35 bg-[#0B0F14] shadow-[0_0_40px_rgba(243,197,54,0.12)] ${className}`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(243,197,54,0.18),transparent_42%)]" />
      <Bot className="relative h-12 w-12 text-[#F3C536]" />
      <div className="absolute bottom-5 h-1 w-8 rounded-full bg-[#F3C536]/80 shadow-[0_0_16px_rgba(243,197,54,0.7)]" />
    </div>
  );
}

function AgentAvatar({ agent, large = false }: { agent?: ProfileAgent; large?: boolean }) {
  const avatar = agent?.metadata?.avatar;

  if (avatar) {
    return (
      <div
        className={
          large
            ? 'h-[170px] w-[170px] overflow-hidden rounded-full border border-[#F3C536]/30 bg-black/30'
            : 'h-14 w-14 overflow-hidden rounded-full border border-[#F3C536]/25 bg-black/30'
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatar} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }

  return <ProfileIcon className={large ? 'h-[170px] w-[170px]' : 'h-14 w-14'} />;
}

function InfoRow({
  icon,
  label,
  value,
  copy,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  copy?: string;
}) {
  return (
    <div className="grid grid-cols-[34px_130px_1fr_28px] items-center gap-3 border-b border-white/[0.06] py-4 last:border-b-0">
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#F3C536]/14 bg-[#F3C536]/8 text-[#F3C536]">
        {icon}
      </div>
      <div className="text-[14px] text-[#F5F0E5]">{label}</div>
      <div className="min-w-0 truncate text-[14px] text-[#EAE4D8]/70">{value || '—'}</div>
      {copy ? (
        <button
          type="button"
          onClick={() => copyToClipboard(copy)}
          className="flex h-7 w-7 items-center justify-center rounded border border-white/10 text-[#EAE4D8]/45 transition hover:border-[#F3C536]/40 hover:text-[#F3C536]"
          aria-label={`Copy ${label}`}
        >
          <Clipboard className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'relative flex items-center gap-3 px-8 py-5 text-[#F3C536]'
          : 'flex items-center gap-3 px-8 py-5 text-[#EAE4D8]/55 transition hover:text-[#F3C536]'
      }
    >
      {icon}
      <span className="text-[15px] font-medium">{label}</span>
      {active && (
        <span className="absolute bottom-0 left-6 right-6 h-[2px] rounded-full bg-[#F3C536] shadow-[0_0_16px_rgba(243,197,54,0.55)]" />
      )}
    </button>
  );
}

function LinkButton({ href, label, icon }: { href?: string; label: string; icon: React.ReactNode }) {
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-12 items-center gap-3 rounded-md border border-white/10 bg-white/[0.025] px-5 text-[14px] text-[#EAE4D8]/70 transition hover:border-[#F3C536]/35 hover:text-[#F3C536]"
    >
      {icon}
      {label}
      <ExternalLink className="h-3.5 w-3.5 opacity-70" />
    </a>
  );
}

export default function AgentProfilePage() {
  const { isConnected, address, ready } = useArcWallet();
  const {
    authenticated: circleAuthenticated,
    address: circleAddress,
    login: circleLogin,
    register: circleRegister,
  } = useCircleWallet();
  const [agents, setAgents] = useState<ProfileAgent[]>(EMPTY_AGENTS);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('basic');
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [reputation, setReputation] = useState<ReputationResponse | null>(null);
  const [reputationLoading, setReputationLoading] = useState(false);

  // Preview domain guard — passkey creation only works on production origin
  const isPreviewDomain = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const origin = window.location.origin;
    return origin.includes('vercel.app') || origin.includes('localhost') || (origin !== 'https://arclayers.xyz' && !origin.includes('127.0.0.1'));
  }, []);

  // Preview mock data — only on non-production domains, never on arclayers.xyz
  const PREVIEW_MOCK = {
    agentAccountAddress: '0x1111111111111111111111111111111111111111',
    ownerUsdc: { raw: '10000000', formatted: '10.00' },
    agentUsdc: { raw: '2000000', formatted: '2.00' },
    ownerGateway: { raw: '1000000', formatted: '1.00' },
    agentGateway: { raw: '0', formatted: '0.00' },
  };

  // Agent Account state
  const [agentAccount, setAgentAccount] = useState<AgentAccountInfo | null>(null);
  const [agentAccountLoading, setAgentAccountLoading] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [createError, setCreateError] = useState('');
  const [showPasskeyRegister, setShowPasskeyRegister] = useState(false);
  const [registerUsername, setRegisterUsername] = useState('');
  const [showManualLink, setShowManualLink] = useState(false);
  const [manualLinkAddress, setManualLinkAddress] = useState('');
  const [manualLinking, setManualLinking] = useState(false);
  const [manualLinkError, setManualLinkError] = useState('');

  // Balance state
  const [ownerBalance, setOwnerBalance] = useState<BalanceInfo | null>(null);
  const [agentBalance, setAgentBalance] = useState<BalanceInfo | null>(null);
  const [ownerGateway, setOwnerGateway] = useState<BalanceInfo | null>(null);
  const [agentGateway, setAgentGateway] = useState<BalanceInfo | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);

  // Fund Agent Account state
  const [fundAmount, setFundAmount] = useState('');
  const [showFundForm, setShowFundForm] = useState(false);
  const fundAgent = useFundAgentAccount(() => {
    if (address) void loadBalances(address, agentAccount?.agentAccountAddress);
    setFundAmount('');
    setShowFundForm(false);
  });

  // Gateway deposit state
  const [gatewayAmount, setGatewayAmount] = useState('1.00');
  const gatewayDeposit = useGatewayDeposit(() => {
    if (address) void loadBalances(address, agentAccount?.agentAccountAddress);
  });

  async function loadAgents(ownerAddr: string, agentAccountAddr?: string | null, signal?: AbortSignal) {
    setLoading(true);
    setNotice('');

    try {
      const normalizedOwner = ownerAddr.toLowerCase();
      const normalizedAgent = agentAccountAddr?.toLowerCase();

      // Fetch from both controllers in parallel
      const controllers = [ownerAddr];
      if (agentAccountAddr && normalizedAgent !== normalizedOwner) {
        controllers.push(agentAccountAddr);
      }

      const results = await Promise.all(
        controllers.map(async (ctrl) => {
          const res = await fetch(
            `/api/a2a/metadata/profile?controller=${encodeURIComponent(ctrl)}`,
            { cache: 'no-store', signal },
          );
          const json = (await res.json()) as ProfileResponse;
          if (!res.ok || !json.ok) return [];
          const source: 'eoa' | 'agent_account' =
            ctrl.toLowerCase() === normalizedAgent ? 'agent_account' : 'eoa';
          return (json.agents || [])
            .filter((a) => a.status === 'minted' && a.agentId)
            .map((a) => ({ ...a, source }));
        }),
      );

      if (signal?.aborted) return;

      // Merge and dedupe by agentId (agent_account wins over eoa)
      const byId = new Map<string, ProfileAgent>();
      for (const agent of results[0] || []) {
        byId.set(agent.agentId, agent);
      }
      for (const agent of results[1] || []) {
        byId.set(agent.agentId, agent); // overwrites eoa entry if duplicate
      }

      const merged = Array.from(byId.values());

      setAgents(merged);
      setSelectedAgentId((current) => {
        if (current && merged.some((agent) => agent.agentId === current)) return current;
        return merged[0]?.agentId || '';
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;

      setAgents([]);
      setSelectedAgentId('');
      setNotice(error instanceof Error ? error.message : 'Failed to load profile agents.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!ready) return;

    if (!isConnected || !address) {
      setAgents([]);
      setSelectedAgentId('');
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    void loadAgents(address, agentAccount?.agentAccountAddress, controller.signal);

    return () => controller.abort();
  }, [ready, isConnected, address, agentAccount?.agentAccountAddress]);

  const selectedAgent = useMemo(() => {
    return agents.find((agent) => agent.agentId === selectedAgentId) || agents[0] || null;
  }, [agents, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgent?.agentId) {
      setReputation(null);
      return;
    }

    const controller = new AbortController();

    async function loadReputation() {
      setReputationLoading(true);

      try {
        const res = await fetch(`/api/a2a/reputation/${encodeURIComponent(selectedAgent.agentId)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!res.ok) {
          setReputation(null);
          return;
        }

        const json = (await res.json()) as ReputationResponse;

        if (!controller.signal.aborted) {
          setReputation(json);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setReputation(null);
      } finally {
        if (!controller.signal.aborted) {
          setReputationLoading(false);
        }
      }
    }

    void loadReputation();

    return () => controller.abort();
  }, [selectedAgent?.agentId]);

  const selectedCapabilities = selectedAgent ? getCapabilities(selectedAgent) : [];
  const selectedLinks = selectedAgent ? getLinks(selectedAgent) : { website: '', docs: '', repo: '', x: '' };
  const selectedMetadataURI = selectedAgent ? getMetadataURI(selectedAgent) : '';
  const selectedRole = selectedAgent ? roleLabel(selectedAgent.metadata?.role) : 'Worker';
  const selectedName = selectedAgent ? getAgentName(selectedAgent) : 'Agent Name';

  const reputationScore = reputation?.reputation?.score ?? reputation?.score ?? '0';
  const reputationFeedback = reputation?.reputation?.feedback ?? reputation?.feedback ?? [];
  const latestFeedback = reputationFeedback[0] || null;
  const latestFeedbackTx = latestFeedback?.txHash || '';

  // ── Agent Account fetching ──────────────────────────────────────────────

  const hasAgentAccount = agentAccount?.agentAccountAddress != null;

  // When on preview domain with no real Agent Account, use mock data for design review
  const useMockData = isPreviewDomain && !hasAgentAccount;

  // Effective values — mock overrides real when in preview mode
  const effectiveAgentAccount = useMockData
    ? { ...agentAccount, agentAccountAddress: PREVIEW_MOCK.agentAccountAddress, ownerAddress: address || '', status: 'active', chainId: 5042002, walletProvider: 'circle_modular', accountType: 'circle_smart_account', id: '', createdAt: '', updatedAt: '' }
    : agentAccount;
  const effectiveHasAgentAccount = useMockData || hasAgentAccount;
  const effectiveOwnerBalance = useMockData ? PREVIEW_MOCK.ownerUsdc : ownerBalance;
  const effectiveAgentBalance = useMockData ? PREVIEW_MOCK.agentUsdc : agentBalance;
  const effectiveOwnerGateway = useMockData ? PREVIEW_MOCK.ownerGateway : ownerGateway;
  const effectiveAgentGateway = useMockData ? PREVIEW_MOCK.agentGateway : agentGateway;

  async function loadAgentAccount() {
    setAgentAccountLoading(true);
    try {
      const res = await fetch('/api/profile/agent-account', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setAgentAccount(json);
      }
    } catch {
      // silent
    } finally {
      setAgentAccountLoading(false);
    }
  }

  async function loadBalances(owner: string, agent?: string | null) {
    if (!owner) return;
    setBalancesLoading(true);
    try {
      const params = new URLSearchParams({ owner });
      if (agent) params.set('agentAccount', agent);
      const res = await fetch(`/api/profile/balances?${params}`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setOwnerBalance(json.owner?.usdc ?? null);
        setAgentBalance(json.agentAccount?.usdc ?? null);
        setOwnerGateway(json.owner?.gateway ?? null);
        setAgentGateway(json.agentAccount?.gateway ?? null);
      }
    } catch {
      // silent
    } finally {
      setBalancesLoading(false);
    }
  }

  async function handleCreateAgentAccount() {
    setCreatingAgent(true);
    setCreateError('');
    try {
      // Preview domain guard — passkey creation requires production origin
      if (isPreviewDomain) {
        setCreateError('Passkey creation is only supported on arclayers.xyz. Preview deployments can display profile data, but Circle Agent Account creation must be done on the production domain.');
        setCreatingAgent(false);
        return;
      }

      // Step 1: Try Circle login (existing passkey)
      let addr: string | undefined;
      if (circleAuthenticated && circleAddress) {
        addr = circleAddress;
      } else {
        try {
          addr = await circleLogin();
        } catch (e) {
          const msg = e instanceof Error ? e.message.toLowerCase() : '';
          const cancelled = msg.includes('cancel') || msg.includes('abort') || msg.includes('notallowed');
          if (cancelled) {
            setCreatingAgent(false);
            return;
          }
          // No existing passkey — show register modal
          setShowPasskeyRegister(true);
          setCreatingAgent(false);
          return;
        }
      }

      // Step 2: link the returned address directly (no React state race)
      if (addr) await linkCircleAddress(addr);
    } catch (e) {
      setCreateError(mapPasskeyError(e));
    } finally {
      setCreatingAgent(false);
    }
  }

  async function handlePasskeyRegister() {
    if (!registerUsername.trim()) return;
    setCreatingAgent(true);
    setCreateError('');
    try {
      const addr = await circleRegister(registerUsername.trim());
      setShowPasskeyRegister(false);
      setRegisterUsername('');
      // Link the returned address directly (no React state race)
      await linkCircleAddress(addr);
    } catch (e) {
      const mapped = mapPasskeyError(e);
      setCreateError(mapped || 'Passkey registration failed');
    } finally {
      setCreatingAgent(false);
    }
  }

  async function linkCircleAddress(addr: string) {
    if (!addr) {
      setCreateError('Circle smart account not ready. Try again.');
      return;
    }

    const res = await fetch('/api/profile/agent-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAccountAddress: addr }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setCreateError(json.error || 'Failed to link agent account');
      return;
    }
    setAgentAccount(json);
    if (address && json.agentAccountAddress) {
      void loadBalances(address, json.agentAccountAddress);
    }
  }

  async function handleManualLink() {
    if (!manualLinkAddress) return;
    setManualLinking(true);
    setManualLinkError('');
    try {
      const res = await fetch('/api/profile/agent-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentAccountAddress: manualLinkAddress }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setManualLinkError(json.error || 'Failed to link agent account');
        return;
      }
      setAgentAccount(json);
      setManualLinkAddress('');
      if (address && json.agentAccountAddress) {
        void loadBalances(address, json.agentAccountAddress);
      }
    } catch {
      setManualLinkError('Network error');
    } finally {
      setManualLinking(false);
    }
  }

  useEffect(() => {
    if (!ready || !isConnected) {
      setAgentAccount(null);
      setOwnerBalance(null);
      setAgentBalance(null);
      return;
    }
    void loadAgentAccount();
  }, [ready, isConnected, address]);

  useEffect(() => {
    if (!address) return;
    void loadBalances(address, agentAccount?.agentAccountAddress);
  }, [address, agentAccount?.agentAccountAddress]);

  return (
    <main className="min-h-screen bg-[#05070A] text-[#F5F0E5]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(243,197,54,0.06),transparent_28%),radial-gradient(circle_at_80%_8%,rgba(255,255,255,0.035),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_46%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:44px_44px]" />

      <section className="relative mx-auto max-w-[1440px] px-6 pb-16 pt-12 sm:px-10 lg:px-16">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <div>
            <h1 className="text-[46px] font-semibold tracking-[-0.055em] text-[#F5F0E5] sm:text-[54px]">
              Agent Profile
            </h1>
            <p className="mt-4 text-[16px] text-[#EAE4D8]/60">
              View and manage your registered agents.
            </p>
          </div>

          <div className="flex flex-col gap-5">
            <Link
              href="/register/erc8004"
              className="inline-flex h-14 items-center justify-center gap-4 rounded-md border border-[#F3C536]/45 bg-transparent px-8 text-[15px] font-medium text-[#F3C536] transition hover:bg-[#F3C536]/10"
            >
              <Plus className="h-5 w-5" />
              Register New Agent
            </Link>

            <div className="flex items-center gap-5 rounded-md border border-white/10 bg-[#080D13]/86 px-6 py-5">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#F3C536]/20 bg-[#F3C536]/8 text-[#F3C536]">
                <Wallet className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] text-[#EAE4D8]/55">Connected Wallet</div>
                <div className="mt-1 truncate text-[15px] tracking-[0.03em] text-[#F5F0E5]">
                  {isConnected ? shortAddress(address) : 'Not connected'}
                </div>
              </div>
              {address && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(address)}
                  className="text-[#EAE4D8]/45 transition hover:text-[#F3C536]"
                  aria-label="Copy wallet address"
                >
                  <Clipboard className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Account Overview + Wallet & Funding ─────────────────────── */}
        {isConnected && (
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {/* Account Overview */}
            <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                Account Overview
              </div>

              {/* Owner Wallet */}
              <div className="mt-4 grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/[0.06] py-3">
                <div className="text-[13px] text-[#EAE4D8]/60">Owner Wallet</div>
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-[13px] text-[#F5F0E5]">
                    {shortAddress(address)}
                  </span>
                  {address && (
                    <button type="button" onClick={() => copyToClipboard(address)} className="text-[#EAE4D8]/45 transition hover:text-[#F3C536]">
                      <Clipboard className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <span className="ml-auto rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                    Connected
                  </span>
                </div>
              </div>

              {/* Agent Account */}
              <div className="grid grid-cols-[1fr_1fr] items-center gap-3 border-b border-white/[0.06] py-3">
                <div className="text-[13px] text-[#EAE4D8]/60">Agent Account</div>
                <div className="flex items-center gap-2">
                  {effectiveHasAgentAccount ? (
                    <>
                      <span className="truncate font-mono text-[13px] text-[#F5F0E5]">
                        {shortAddress(effectiveAgentAccount?.agentAccountAddress ?? '')}
                      </span>
                      <button type="button" onClick={() => copyToClipboard(effectiveAgentAccount?.agentAccountAddress ?? '')} className="text-[#EAE4D8]/45 transition hover:text-[#F3C536]">
                        <Clipboard className="h-3.5 w-3.5" />
                      </button>
                      <span className="ml-auto rounded-md border border-[#F3C536]/20 bg-[#F3C536]/10 px-2 py-0.5 font-mono text-[10px] text-[#F3C536]">
                        Active
                      </span>
                    </>
                  ) : (
                    <span className="text-[13px] text-[#EAE4D8]/40">Not created</span>
                  )}
                </div>
              </div>

              {/* Agent Identity */}
              <div className="grid grid-cols-[1fr_1fr] items-center gap-3 py-3">
                <div className="text-[13px] text-[#EAE4D8]/60">Agent Identity</div>
                <div className="text-[13px] text-[#F5F0E5]">
                  {agents.length > 0 ? `Agent ${agents[0].agentId}` : 'No Agent ID yet'}
                </div>
              </div>

              <p className="mt-1 text-[11px] leading-5 text-[#EAE4D8]/35">
                Used as ERC-8004 controller and agent operating account.
              </p>

              {/* CTAs */}
              <div className="mt-4 flex flex-wrap gap-3">
                {!effectiveHasAgentAccount && !showPasskeyRegister && isPreviewDomain && (
                  <p className="text-[12px] leading-5 text-[#EAE4D8]/50">
                    Passkey creation is only supported on{' '}
                    <a href="https://arclayers.xyz/profile" target="_blank" rel="noreferrer" className="text-[#F3C536] underline decoration-[#F3C536]/30 hover:decoration-[#F3C536]">
                      arclayers.xyz
                    </a>
                    . Preview deployments can display profile data, but Agent Account creation must be done on the production domain.
                  </p>
                )}
                {!effectiveHasAgentAccount && !showPasskeyRegister && !isPreviewDomain && (
                  <button
                    type="button"
                    onClick={handleCreateAgentAccount}
                    disabled={creatingAgent}
                    className="h-10 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070] disabled:opacity-40"
                  >
                    {creatingAgent ? 'Creating...' : 'Create Agent Account'}
                  </button>
                )}
                {showPasskeyRegister && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={registerUsername}
                      onChange={(e) => { setRegisterUsername(e.target.value); setCreateError(''); }}
                      placeholder="Choose a username"
                      className="h-10 w-[200px] rounded-md border border-white/10 bg-[#0A0D12] px-3 font-mono text-[12px] text-[#F5F0E5] placeholder-[#EAE4D8]/30 outline-none focus:border-[#F3C536]/40"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handlePasskeyRegister}
                      disabled={creatingAgent || !registerUsername.trim()}
                      className="h-10 rounded-md bg-[#F3C536] px-4 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070] disabled:opacity-40"
                    >
                      {creatingAgent ? 'Creating...' : 'Create Passkey'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowPasskeyRegister(false); setCreateError(''); }}
                      className="h-10 rounded-md border border-white/10 px-3 text-[12px] text-[#EAE4D8]/60 transition hover:text-[#F5F0E5]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {effectiveHasAgentAccount && agents.length === 0 && (
                  <Link href="/register/erc8004" className="inline-flex h-10 items-center gap-2 rounded-md border border-[#F3C536]/40 bg-transparent px-5 text-[12px] font-medium text-[#F3C536] transition hover:bg-[#F3C536]/10">
                    <Plus className="h-4 w-4" /> Register ERC-8004 Agent
                  </Link>
                )}
                {effectiveHasAgentAccount && agents.length > 0 && (
                  <Link href="/agent-setup" className="inline-flex h-10 items-center gap-2 rounded-md border border-[#F3C536]/40 bg-transparent px-5 text-[12px] font-medium text-[#F3C536] transition hover:bg-[#F3C536]/10">
                    <Bot className="h-4 w-4" /> Open Agent Setup
                  </Link>
                )}
              </div>
              {createError && <p className="mt-2 text-[12px] text-red-400">{createError}</p>}

              {/* Advanced: manual link */}
              {!effectiveHasAgentAccount && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setShowManualLink((v) => !v)}
                    className="text-[11px] text-[#EAE4D8]/35 transition hover:text-[#EAE4D8]/60"
                  >
                    {showManualLink ? '▾ Hide' : '▸ Advanced: link existing address'}
                  </button>
                  {showManualLink && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="0x... Agent Account address"
                        value={manualLinkAddress}
                        onChange={(e) => { setManualLinkAddress(e.target.value); setManualLinkError(''); }}
                        className="h-9 w-[260px] rounded-md border border-white/10 bg-[#0A0D12] px-3 font-mono text-[11px] text-[#F5F0E5] placeholder-[#EAE4D8]/30 outline-none focus:border-[#F3C536]/40"
                      />
                      <button
                        type="button"
                        onClick={handleManualLink}
                        disabled={manualLinking || !manualLinkAddress}
                        className="h-9 rounded-md border border-white/10 px-3 text-[11px] text-[#EAE4D8]/60 transition hover:border-[#F3C536]/40 hover:text-[#F3C536] disabled:opacity-40"
                      >
                        {manualLinking ? 'Linking...' : 'Link'}
                      </button>
                    </div>
                  )}
                  {manualLinkError && <p className="mt-1 text-[11px] text-red-400">{manualLinkError}</p>}
                </div>
              )}
            </div>

            {/* Wallet & Funding */}
            <div className="rounded-lg border border-white/10 bg-[#07090D]/88 px-7 py-5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
              <div className="flex items-center gap-3">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">
                  Wallet & Funding
                </div>
                {useMockData && (
                  <span className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-amber-300">
                    Preview mock data
                  </span>
                )}
              </div>

              {!effectiveHasAgentAccount ? (
                <div className="mt-6 text-center">
                  <p className="text-[13px] text-[#EAE4D8]/45">
                    Create an Agent Account first to get a deposit address.
                  </p>
                </div>
              ) : (
                <>
                  {/* ── Owner Wallet Balances ──────────────────────────── */}
                  <div className="mt-4 text-[12px] font-medium text-[#EAE4D8]/60">Owner Wallet</div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/38">
                        USDC
                      </div>
                      <div className="mt-2 text-[18px] font-semibold text-[#F5F0E5]">
                        {balancesLoading && !useMockData ? '...' : effectiveOwnerBalance?.formatted ?? '0.00'}
                      </div>
                      <div className="mt-1 text-[10px] text-[#EAE4D8]/30">ERC-20 balance</div>
                    </div>
                    <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/38">
                        x402 Gateway
                      </div>
                      <div className="mt-2 text-[18px] font-semibold text-[#F5F0E5]">
                        {balancesLoading && !useMockData ? '...' : effectiveOwnerGateway?.formatted ?? '0.00'}
                      </div>
                      <div className="mt-1 text-[10px] text-[#EAE4D8]/30">Paid API access</div>
                    </div>
                  </div>

                  {/* ── Agent Account Balances ─────────────────────────── */}
                  <div className="mt-4 text-[12px] font-medium text-[#EAE4D8]/60">Agent Account</div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/38">
                        USDC
                      </div>
                      <div className="mt-2 text-[18px] font-semibold text-[#F3C536]">
                        {balancesLoading && !useMockData ? '...' : effectiveAgentBalance?.formatted ?? '0.00'}
                      </div>
                      <div className="mt-1 text-[10px] text-[#EAE4D8]/30">ERC-8004 / ERC-8183</div>
                    </div>
                    <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/38">
                        x402 Gateway
                      </div>
                      <div className="mt-2 text-[18px] font-semibold text-[#F5F0E5]">
                        {balancesLoading && !useMockData ? '...' : effectiveAgentGateway?.formatted ?? '—'}
                      </div>
                      <div className="mt-1 text-[10px] text-[#EAE4D8]/30">Read-only</div>
                    </div>
                  </div>

                  <p className="mt-3 text-[11px] leading-5 text-[#EAE4D8]/35">
                    Your EOA is the owner and funding source. Your Agent Account is the operational account for agent actions.
                  </p>

                  {/* ── Fund Agent Account ─────────────────────────────── */}
                  {showFundForm ? (
                    <div className="mt-4 rounded-md border border-white/10 bg-[#0A0D12] p-4">
                      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/38">
                        Fund Agent Account
                      </div>
                      <p className="mt-1 text-[11px] text-[#EAE4D8]/35">
                        Transfer USDC from your owner wallet to your Agent Account.
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Amount (USDC)"
                          value={fundAmount}
                          onChange={(e) => { setFundAmount(e.target.value); fundAgent.reset(); }}
                          className="h-9 w-[160px] rounded-md border border-white/10 bg-[#05070A] px-3 font-mono text-[12px] text-[#F5F0E5] placeholder-[#EAE4D8]/30 outline-none focus:border-[#F3C536]/40"
                        />
                        <button
                          type="button"
                          onClick={() => void fundAgent.fund(fundAmount, agentAccount?.agentAccountAddress ?? '')}
                          disabled={!fundAmount || (fundAgent.step !== 'idle' && fundAgent.step !== 'error')}
                          className="h-9 rounded-md bg-[#F3C536] px-4 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070] disabled:opacity-40"
                        >
                          {fundAgent.step === 'checking' || fundAgent.step === 'transferring' || fundAgent.step === 'confirming'
                            ? 'Sending...'
                            : 'Send'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowFundForm(false); setFundAmount(''); fundAgent.reset(); }}
                          className="h-9 rounded-md border border-white/10 px-3 text-[12px] text-[#EAE4D8]/60 transition hover:text-[#F5F0E5]"
                        >
                          Cancel
                        </button>
                      </div>
                      {fundAgent.error && (
                        <p className="mt-2 text-[11px] text-red-400">{fundAgent.error}</p>
                      )}
                      {fundAgent.txHash && (
                        <p className="mt-2 text-[11px] text-emerald-400">
                          Sent ✓{' '}
                          <a
                            href={`https://testnet.arcscan.app/tx/${fundAgent.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-emerald-400/40 hover:text-emerald-300"
                          >
                            {shortAddress(fundAgent.txHash)}
                          </a>
                        </p>
                      )}
                    </div>
                  ) : null}

                  {/* ── Actions ────────────────────────────────────────── */}
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => { if (address) void loadBalances(address, agentAccount?.agentAccountAddress); }}
                      disabled={balancesLoading}
                      className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-transparent px-4 text-[12px] text-[#EAE4D8]/60 transition hover:border-[#F3C536]/40 hover:text-[#F3C536] disabled:opacity-40"
                    >
                      <RefreshCcw className={`h-3.5 w-3.5 ${balancesLoading ? 'animate-spin' : ''}`} />
                      Refresh Balances
                    </button>
                    {!showFundForm && (
                      <button
                        type="button"
                        onClick={() => { setShowFundForm(true); fundAgent.reset(); }}
                        className="h-10 rounded-md bg-[#F3C536] px-5 text-[12px] font-semibold text-[#07090D] transition hover:bg-[#FFE070]"
                      >
                        Fund Agent Account
                      </button>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Amount"
                        value={gatewayAmount}
                        onChange={(e) => { setGatewayAmount(e.target.value); gatewayDeposit.reset(); }}
                        className="h-10 w-[100px] rounded-md border border-white/10 bg-transparent px-3 font-mono text-[12px] text-[#F5F0E5] placeholder-[#EAE4D8]/30 outline-none focus:border-[#F3C536]/40"
                      />
                      <button
                        type="button"
                        onClick={() => void gatewayDeposit.deposit(gatewayAmount)}
                        disabled={(gatewayDeposit.step !== 'idle' && gatewayDeposit.step !== 'error' && gatewayDeposit.step !== 'success') || !gatewayAmount}
                        className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 bg-transparent px-4 text-[12px] text-[#EAE4D8]/60 transition hover:border-[#F3C536]/40 hover:text-[#F3C536] disabled:opacity-40"
                      >
                        Deposit EOA → Gateway
                      </button>
                    </div>
                  </div>
                  {gatewayDeposit.txHash && (
                    <p className="mt-2 text-[11px] text-emerald-400">
                      Gateway deposit sent ✓{' '}
                      <a
                        href={`https://testnet.arcscan.app/tx/${gatewayDeposit.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-emerald-400/40 hover:text-emerald-300"
                      >
                        {shortAddress(gatewayDeposit.txHash)}
                      </a>
                    </p>
                  )}
                  {gatewayDeposit.error && (
                    <p className="mt-2 text-[11px] text-red-400">{gatewayDeposit.error}</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Setup section ────────────────────────────────────────────── */}
        {isConnected && effectiveHasAgentAccount && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Link href="/agent-setup" className="rounded-lg border border-white/10 bg-[#07090D]/88 px-6 py-4 transition hover:border-[#F3C536]/30">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">Manual PM2 Bot</div>
              <p className="mt-2 text-[12px] leading-5 text-[#EAE4D8]/50">
                Run an external provider bot on your VPS.
              </p>
            </Link>
            <Link href="/agent-setup" className="rounded-lg border border-white/10 bg-[#07090D]/88 px-6 py-4 transition hover:border-[#F3C536]/30">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#F3C536]">MCP for Claude / Codex</div>
              <p className="mt-2 text-[12px] leading-5 text-[#EAE4D8]/50">
                Manage ArcLayer actions through approval-gated MCP tools.
              </p>
            </Link>
          </div>
        )}

        {/* ── MCP Prompt Template ──────────────────────────────── */}
        {isConnected && effectiveHasAgentAccount && <McpPromptCard />}

        {!ready || loading ? (
          <div className="mt-10 flex min-h-[420px] items-center justify-center rounded-xl border border-white/10 bg-[#080D13]/70">
            <div className="flex items-center gap-3 text-[#EAE4D8]/60">
              <Loader2 className="h-5 w-5 animate-spin text-[#F3C536]" />
              Loading agent profile...
            </div>
          </div>
        ) : !isConnected ? (
          <div className="mt-10 rounded-xl border border-[#F3C536]/24 bg-[#080D13]/78 p-10">
            <div className="max-w-xl">
              <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-[#F3C536]">
                Wallet Required
              </div>
              <h2 className="mt-4 text-[30px] font-semibold tracking-[-0.04em]">Connect wallet to view Profile</h2>
              <p className="mt-3 text-[15px] leading-7 text-[#EAE4D8]/58">
                Profile uses your connected wallet to find minted ERC-8183 agent identities.
              </p>
            </div>
          </div>
        ) : agents.length === 0 ? (
          <div className="mt-10 rounded-xl border border-[#F3C536]/24 bg-[#080D13]/78 p-10">
            <div className="max-w-xl">
              <div className="font-mono text-[12px] uppercase tracking-[0.18em] text-[#F3C536]">
                No Agents Found
              </div>
              <h2 className="mt-4 text-[30px] font-semibold tracking-[-0.04em]">Register your first ERC-8183 agent</h2>
              <p className="mt-3 text-[15px] leading-7 text-[#EAE4D8]/58">
                Minted agent identities owned by this wallet will appear here.
              </p>
              <Link
                href="/register/erc8004"
                className="mt-7 inline-flex h-12 items-center justify-center gap-3 rounded-md bg-[#F3C536] px-6 text-[14px] font-semibold text-[#07090D] transition hover:bg-[#FFE070]"
              >
                <Plus className="h-4 w-4" />
                Register ERC-8183 Agent
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-10 overflow-hidden rounded-xl border border-[#1A2228] bg-[#080D13]/78 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]">
              <div className="relative grid min-h-[300px] gap-8 p-8 md:grid-cols-[230px_1fr]">
                <div className="absolute inset-0 opacity-50 [background-image:radial-gradient(circle_at_85%_15%,rgba(243,197,54,0.16),transparent_28%),linear-gradient(135deg,transparent_40%,rgba(243,197,54,0.10)_70%,transparent_100%)]" />
                <div className="relative flex items-center justify-center">
                  <AgentAvatar agent={selectedAgent || undefined} large />
                </div>

                <div className="relative flex flex-col justify-center">
                  <div className="flex flex-wrap items-center gap-4">
                    <h2 className="text-[38px] font-semibold tracking-[-0.045em] text-[#F5F0E5]">
                      {selectedName}
                    </h2>
                    <span className="inline-flex items-center gap-2 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-[14px] text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />
                      Minted
                    </span>
                  </div>

                  <div className="mt-8 grid max-w-[620px] gap-4 text-[16px] md:grid-cols-[140px_1fr]">
                    <div className="flex items-center gap-3 text-[#F3C536]">
                      <BadgeCheck className="h-5 w-5" />
                      <span className="text-[#EAE4D8]/62">Agent ID:</span>
                    </div>
                    <div>{selectedAgent?.agentId}</div>

                    <div className="flex items-center gap-3 text-[#F3C536]">
                      <UserRound className="h-5 w-5" />
                      <span className="text-[#EAE4D8]/62">Role:</span>
                    </div>
                    <div>{selectedRole}</div>

                    <div className="flex items-center gap-3 text-[#F3C536]">
                      <ShieldCheck className="h-5 w-5" />
                      <span className="text-[#EAE4D8]/62">Capabilities:</span>
                    </div>
                    <div className="truncate">
                      {selectedCapabilities.length > 0 ? selectedCapabilities.slice(0, 4).join(', ') : '—'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex gap-4 overflow-x-auto pb-2">
              {agents.map((agent) => {
                const active = selectedAgent?.agentId === agent.agentId;

                return (
                  <button
                    key={agent.agentId}
                    type="button"
                    onClick={() => {
                      setSelectedAgentId(agent.agentId);
                      setActiveTab('basic');
                      setMetadataOpen(false);
                    }}
                    className={
                      active
                        ? 'flex h-[132px] min-w-[260px] items-center gap-5 rounded-lg border border-[#F3C536]/50 bg-[#F3C536]/[0.055] p-5 text-left shadow-[0_0_24px_rgba(243,197,54,0.10)]'
                        : 'flex h-[132px] min-w-[260px] items-center gap-5 rounded-lg border border-white/10 bg-[#080D13]/76 p-5 text-left transition hover:border-[#F3C536]/30'
                    }
                  >
                    <AgentAvatar agent={agent} />
                    <div className="min-w-0">
                      <div className="truncate text-[16px] font-medium text-[#F5F0E5]">{getAgentName(agent)}</div>
                      <div className="mt-2 flex items-center gap-2 text-[13px] text-[#EAE4D8]/55">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        Minted
                      </div>
                      {agent.source === 'agent_account' && (
                        <div className="mt-1 text-[10px] tracking-[0.12em] text-[#F3C536]/60">
                          Agent Account
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}

              <Link
                href="/register/erc8004"
                className="flex h-[132px] min-w-[140px] flex-col items-center justify-center rounded-lg border border-white/10 bg-[#080D13]/76 text-[#EAE4D8]/60 transition hover:border-[#F3C536]/35 hover:text-[#F3C536]"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[#F3C536]/30">
                  <Plus className="h-6 w-6" />
                </span>
                <span className="mt-3 text-[14px]">Add Agent</span>
              </Link>
            </div>

            <div className="mt-8 overflow-hidden rounded-xl border border-white/10 bg-[#080D13]/80">
              <div className="flex border-b border-white/10">
                <TabButton
                  active={activeTab === 'basic'}
                  onClick={() => setActiveTab('basic')}
                  icon={<BadgeCheck className="h-5 w-5" />}
                  label="Basic Info"
                />
                <TabButton
                  active={activeTab === 'capabilities'}
                  onClick={() => setActiveTab('capabilities')}
                  icon={<ShieldCheck className="h-5 w-5" />}
                  label="Capabilities"
                />
                <TabButton
                  active={activeTab === 'links'}
                  onClick={() => setActiveTab('links')}
                  icon={<Link2 className="h-5 w-5" />}
                  label="Links"
                />
                <TabButton
                  active={activeTab === 'reputation'}
                  onClick={() => setActiveTab('reputation')}
                  icon={<Medal className="h-5 w-5" />}
                  label="Reputation"
                />
                <TabButton
                  active={activeTab === 'metadata'}
                  onClick={() => setActiveTab('metadata')}
                  icon={<FileJson className="h-5 w-5" />}
                  label="Metadata"
                />
              </div>

              <div className="grid gap-8 p-8 lg:grid-cols-[1fr_1fr]">
                <div>
                  <InfoRow
                    icon={<BadgeCheck className="h-4 w-4" />}
                    label="Agent ID"
                    value={selectedAgent?.agentId}
                    copy={selectedAgent?.agentId}
                  />
                  <InfoRow
                    icon={<UserRound className="h-4 w-4" />}
                    label="Role"
                    value={selectedRole}
                  />
                  <InfoRow
                    icon={<Wallet className="h-4 w-4" />}
                    label="Controller"
                    value={shortAddress(selectedAgent?.controller)}
                    copy={selectedAgent?.controller}
                  />
                  <InfoRow
                    icon={<Link2 className="h-4 w-4" />}
                    label="Metadata URI"
                    value={selectedMetadataURI ? shortAddress(selectedMetadataURI) : '—'}
                    copy={selectedMetadataURI}
                  />
                  <InfoRow
                    icon={<KeyRound className="h-4 w-4" />}
                    label="Tx Hash"
                    value={selectedAgent?.txHash ? shortAddress(selectedAgent.txHash) : '—'}
                    copy={selectedAgent?.txHash}
                  />
                </div>

                <div className="border-white/10 lg:border-l lg:pl-8">
                  {activeTab === 'basic' && (
                    <div>
                      <h3 className="flex items-center gap-3 text-[18px] font-semibold">
                        <BadgeCheck className="h-5 w-5 text-[#F3C536]" />
                        Basic Info
                      </h3>
                      <p className="mt-3 text-[14px] leading-6 text-[#EAE4D8]/55">
                        This identity is minted on ERC-8004. Runtime and PM2 setup are separate.
                      </p>
                      <div className="mt-6 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
                          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/38">
                            Status
                          </div>
                          <div className="mt-2 text-emerald-300">Minted</div>
                        </div>
                        <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
                          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/38">
                            Next
                          </div>
                          <div className="mt-2 text-[#EAE4D8]/70">PM2 setup later</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'capabilities' && (
                    <div>
                      <h3 className="flex items-center gap-3 text-[18px] font-semibold">
                        <ShieldCheck className="h-5 w-5 text-[#F3C536]" />
                        Capabilities
                      </h3>
                      <div className="mt-6 flex flex-wrap gap-3">
                        {selectedCapabilities.length > 0 ? (
                          selectedCapabilities.map((item) => (
                            <span
                              key={item}
                              className="rounded-md border border-[#F3C536]/35 bg-[#F3C536]/[0.055] px-4 py-2 font-mono text-[12px] tracking-[0.04em] text-[#F3C536]"
                            >
                              {item}
                            </span>
                          ))
                        ) : (
                          <p className="text-[14px] text-[#EAE4D8]/55">No capabilities found.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {activeTab === 'links' && (
                    <div>
                      <h3 className="flex items-center gap-3 text-[18px] font-semibold">
                        <Link2 className="h-5 w-5 text-[#F3C536]" />
                        Links
                      </h3>
                      <div className="mt-6 flex flex-wrap gap-3">
                        <LinkButton href={selectedLinks.website} label="Website" icon={<Globe className="h-5 w-5" />} />
                        <LinkButton href={selectedLinks.docs} label="Docs" icon={<FileJson className="h-5 w-5" />} />
                        <LinkButton href={selectedLinks.repo} label="Repo" icon={<Code2 className="h-5 w-5" />} />
                        <LinkButton href={selectedLinks.x} label="X" icon={<X className="h-5 w-5" />} />
                        {!selectedLinks.website && !selectedLinks.docs && !selectedLinks.repo && !selectedLinks.x && (
                          <p className="text-[14px] text-[#EAE4D8]/55">No links provided.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {activeTab === 'reputation' && (
                    <div>
                      <h3 className="flex items-center gap-3 text-[18px] font-semibold">
                        <Medal className="h-5 w-5 text-[#F3C536]" />
                        Reputation
                      </h3>

                      <p className="mt-3 text-[14px] leading-6 text-[#EAE4D8]/55">
                        Feedback written to the ERC-8004 Reputation Registry and indexed by ArcLayer.
                      </p>

                      <div className="mt-6 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
                          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/38">
                            Score
                          </div>
                          <div className="mt-2 text-[#F3C536]">
                            {reputationLoading ? 'Loading…' : reputationScore}
                          </div>
                        </div>

                        <div className="rounded-md border border-white/10 bg-white/[0.025] p-4">
                          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#EAE4D8]/38">
                            Feedback
                          </div>
                          <div className="mt-2 text-[#EAE4D8]/70">
                            {reputationLoading ? 'Loading…' : reputationFeedback.length}
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 space-y-0 rounded-md border border-white/10 bg-white/[0.018] px-4">
                        <InfoRow
                          icon={<Medal className="h-4 w-4" />}
                          label="Score"
                          value={reputationLoading ? 'Loading…' : reputationScore}
                        />
                        <InfoRow
                          icon={<BadgeCheck className="h-4 w-4" />}
                          label="Feedback Count"
                          value={reputationLoading ? 'Loading…' : String(reputationFeedback.length)}
                        />
                        <InfoRow
                          icon={<ShieldCheck className="h-4 w-4" />}
                          label="Source"
                          value="ERC-8004"
                        />
                        <InfoRow
                          icon={<KeyRound className="h-4 w-4" />}
                          label="Latest Tx"
                          value={
                            latestFeedbackTx ? (
                              <a
                                href={`https://testnet.arcscan.app/tx/${latestFeedbackTx}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[#EAE4D8]/70 transition hover:text-[#F3C536]"
                              >
                                {shortAddress(latestFeedbackTx)}
                              </a>
                            ) : (
                              '—'
                            )
                          }
                          copy={latestFeedbackTx}
                        />
                      </div>

                      {latestFeedback?.comment && (
                        <div className="mt-5 rounded-md border border-[#F3C536]/18 bg-[#F3C536]/[0.035] p-4">
                          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#F3C536]">
                            Latest Feedback
                          </div>
                          <p className="mt-2 text-[14px] leading-6 text-[#EAE4D8]/72">
                            {latestFeedback.comment}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'metadata' && (
                    <div>
                      <h3 className="flex items-center gap-3 text-[18px] font-semibold">
                        <FileJson className="h-5 w-5 text-[#F3C536]" />
                        Metadata
                      </h3>
                      <p className="mt-3 text-[14px] leading-6 text-[#EAE4D8]/55">
                        View a summary of the agent&apos;s identity metadata.
                      </p>
                      <button
                        type="button"
                        onClick={() => setMetadataOpen((value) => !value)}
                        className="mt-6 inline-flex h-12 items-center gap-3 rounded-md border border-[#F3C536]/35 px-6 text-[14px] text-[#F3C536] transition hover:bg-[#F3C536]/10"
                      >
                        <Code2 className="h-4 w-4" />
                        {metadataOpen ? 'Hide JSON' : 'Show JSON'}
                      </button>

                      {metadataOpen && selectedAgent && (
                        <pre className="mt-5 max-h-[360px] overflow-auto rounded-md border border-white/10 bg-[#05070A] p-4 text-[11px] leading-5 text-[#EAE4D8]/62">
                          {JSON.stringify(selectedAgent.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {notice && (
          <div className="mt-6 flex items-center justify-between rounded-md border border-rose-400/25 bg-rose-400/[0.055] px-5 py-4 text-[13px] text-rose-200">
            <span>{notice}</span>
            {address && (
              <button
                type="button"
                onClick={() => loadAgents(address, agentAccount?.agentAccountAddress)}
                className="inline-flex items-center gap-2 text-rose-100 underline decoration-rose-300/40 underline-offset-4"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                Retry
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
