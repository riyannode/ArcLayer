'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readContract, waitForTransactionReceipt } from '@wagmi/core';
import { keccak256, stringToBytes } from 'viem';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useArcWrite } from '@/hooks/useArcWrite';
import { useArcSign } from '@/hooks/useArcSign';
import { AGENT_REGISTRY_ABI, buildRegisterAgentConfig, CONTRACTS } from '@arclayer/sdk';
import { StatusBanner } from '@/components/StatusBanner';
import { InlineProtectionNotice, NOTICE_WALLET_NOT_CONNECTED } from '@/components/protection';
import { LLMAgentConnectKit } from '@/components/LLMAgentConnectKit';
import { config } from '@/lib/wagmi';
import { nameToAgentId, normalizeAgentName, shortAgentId } from '@/lib/agentName';
import { AGENT_CATEGORIES } from '@/app/live-a2a-agent/categories';

type NameStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'free'; agentId: bigint }
  | { state: 'taken'; agentId: bigint }
  | { state: 'invalid'; reason: string };

type IntegrationMode = 'seller' | 'consumer' | 'hybrid';

type RuntimeHost =
  | 'self-hosted'
  | 'onchain-only'
  | 'arclayer-cloud'
  | 'vercel'
  | 'cloudflare'
  | 'supabase-edge'
  | 'browser';

type HostStatus = 'live' | 'soon';

type HostOption = {
  id: RuntimeHost;
  title: string;
  tag: string;
  desc: string;
  status: HostStatus;
};

type RuntimeProvider = 'claude' | 'hermes' | 'openclaw' | 'openai-compatible' | 'local-command';

type RuntimeRoleForm = {
  id: string;
  name: string;
  category: string;
  provider: RuntimeProvider;
  model: string;
  capabilities: string;
  price: string;
  x402AmountAtomic: string;
  endpointPath: string;
  enabled: boolean;
};

const PROVIDERS: Array<{ id: RuntimeProvider; label: string }> = [
  { id: 'claude', label: 'Claude' },
  { id: 'hermes', label: 'Hermes' },
  { id: 'openclaw', label: 'OpenClaw' },
  { id: 'openai-compatible', label: 'OpenAI-compatible' },
  { id: 'local-command', label: 'Local command' },
];

const ROLE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

const MODES: Array<{ id: IntegrationMode; title: string; desc: string }> = [
  { id: 'seller', title: 'Job Taker', desc: 'Take jobs, run work, and get paid.' },
  { id: 'consumer', title: 'Job Creator', desc: 'Create jobs and receive results.' },
  { id: 'hybrid', title: 'Creator + Taker', desc: 'Create jobs and also take jobs.' },
];

const HOSTS: HostOption[] = [
  {
    id: 'self-hosted',
    title: 'Self-Hosted',
    tag: 'YOUR VPS',
    desc: 'Run your agent on your own VPS.',
    status: 'live',
  },
  {
    id: 'onchain-only',
    title: 'On-Chain Only',
    tag: 'NO RUNTIME',
    desc: 'Register identity + metadata. No off-chain runtime required.',
    status: 'live',
  },
  {
    id: 'arclayer-cloud',
    title: 'ArcLayer Cloud',
    tag: 'MANAGED',
    desc: 'Managed hosting for your agent runtime.',
    status: 'soon',
  },
  {
    id: 'vercel',
    title: 'Vercel Edge + Cron',
    tag: 'SERVERLESS',
    desc: 'Edge functions on a cron schedule.',
    status: 'soon',
  },
  {
    id: 'cloudflare',
    title: 'Cloudflare Workers',
    tag: 'DURABLE OBJECTS',
    desc: 'Run stateful agents on Workers.',
    status: 'soon',
  },
  {
    id: 'supabase-edge',
    title: 'Supabase Edge',
    tag: 'PG_CRON',
    desc: 'Run scheduled agents with Supabase Edge Functions.',
    status: 'soon',
  },
  {
    id: 'browser',
    title: 'Browser Agent',
    tag: 'CLIENT-SIDE',
    desc: 'Run lightweight agents in the browser.',
    status: 'soon',
  },
];

const STARTER_CODE = `import express from 'express';
import { x402Middleware } from './x402-middleware';

const app = express();
app.use(express.json());

const receiver = '0xYourAgentWallet';

app.get('/.well-known/arclayer-agent.json', (_req, res) => {
  res.json({
    schema: 'arclayer.agent/v1',
    name: 'my-external-agent',
    endpoint: 'https://your-agent.example.com',
    mode: 'dual',
    categories: ['development'],
    capabilities: ['claim_job', 'run_job', 'submit_proof'],
    x402: { enabled: true, network: 'arc-testnet', currency: 'USDC', receiver },
  });
});

app.post('/jobs/run', x402Middleware({
  price: '0.000001',
  receiver,
  network: 'arc-testnet',
}), async (req, res) => {
  // Route to your own Claude, Hermes, OpenClaw, or custom LLM runtime here.
  res.json({ ok: true, result: 'completed', proof: { type: 'signed_result' } });
});

app.listen(4001);`;

const SELF_HOSTED_STACK: Array<{ step: string; title: string; body: string }> = [
  { step: '01', title: 'External runtime', body: 'Your agent keeps running on your infrastructure.' },
  { step: '02', title: 'Manifest + roles', body: 'Publish endpoint, roles, and price.' },
  { step: '03', title: 'Job access', body: 'Create, find, claim, and submit jobs through ArcLayer.' },
  { step: '04', title: 'Payment rails', body: 'Verify payment and settle to wallet.' },
  { step: '05', title: 'Reputation layer', body: 'Completed work builds visible reputation.' },
];

const SELF_HOSTED_CHECKLIST = [
  'Create wallet/controller for this runtime',
  'Deploy public HTTPS server',
  'Expose /.well-known/arclayer-agent.json manifest',
  'Define roles and x402 receiver',
  'Expose job runner endpoint like POST /jobs/run',
  'Register endpoint + manifest on ArcLayer',
  'Test create → claim → submit proof',
];

const ONCHAIN_CHECKLIST = [
  'Create wallet/controller for this agent',
  'Define skill label + categories',
  'Register identity + metadata on-chain',
  'Verify discovery on /a2a after indexer sync',
];

function buildManifestPointerURI(agentId: bigint) {
  return `arclayer://manifest/${agentId.toString()}`;
}

function toManifestMode(mode: IntegrationMode): 'seller' | 'buyer' | 'dual' {
  if (mode === 'consumer') return 'buyer';
  if (mode === 'hybrid') return 'dual';
  return 'seller';
}

function splitCsv(value: string): string[] {
  return value.split(',').map((x) => x.trim()).filter(Boolean);
}

function makeDefaultRole(category = 'prediction-market'): RuntimeRoleForm {
  return {
    id: 'signal-oracle',
    name: 'Signal Oracle',
    category,
    provider: 'openai-compatible',
    model: 'KIRO',
    capabilities: 'claim_job, run_job, submit_proof, market_signal',
    price: '0.000001 USDC/call',
    x402AmountAtomic: '1',
    endpointPath: '/x402/jobs/run',
    enabled: true,
  };
}

function normalizeRole(role: RuntimeRoleForm) {
  return {
    id: role.id.trim(),
    name: role.name.trim(),
    category: role.category.trim(),
    provider: role.provider,
    model: role.model.trim(),
    capabilities: splitCsv(role.capabilities),
    price: role.price.trim(),
    x402AmountAtomic: role.x402AmountAtomic.trim(),
    endpointPath: role.endpointPath.trim(),
    enabled: role.enabled,
  };
}

function validateRoles(roles: RuntimeRoleForm[], endpoint: string): string | null {
  const enabledRoles = roles.filter((role) => role.enabled).map(normalizeRole);
  if (enabledRoles.length === 0) return 'Enable at least one runtime role.';
  const ids = new Set<string>();
  for (const role of enabledRoles) {
    if (!ROLE_ID_RE.test(role.id)) return `Role ID "${role.id}" must be a lowercase slug.`;
    if (ids.has(role.id)) return `Role ID "${role.id}" is duplicated.`;
    if (!role.name) return `Role "${role.id}" needs a name.`;
    if (!role.category) return `Role "${role.id}" needs a category.`;
    if (role.capabilities.length === 0) return `Role "${role.id}" needs at least one capability.`;
    if (!/^\d+$/.test(role.x402AmountAtomic)) return `Role "${role.id}" x402 atomic amount must be numeric.`;
    if (!role.endpointPath.startsWith('/')) return `Role "${role.id}" endpoint path must start with /.`;
    ids.add(role.id);
  }
  if (endpoint.trim() && !/^https:\/\//.test(endpoint.trim())) return 'Self-hosted endpoint must be HTTPS.';
  return null;
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }
  return 'null';
}

export default function RegisterAutonomousPage() {
  const router = useRouter();
  const [initialCategory, setInitialCategory] = useState('prediction-market');
  const defaultCategory = AGENT_CATEGORIES.some((c) => c.key === initialCategory) ? initialCategory : 'prediction-market';
  const { isConnected, address } = useArcWallet();
  const { writeContractAsync } = useArcWrite();
  const { signMessageAsync } = useArcSign();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txState, setTxState] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'idle' | 'pending' | 'synced' | 'error'>('idle');
  const [copied, setCopied] = useState(false);
  const [expandedHost, setExpandedHost] = useState<RuntimeHost | null>(null);
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistSent, setWaitlistSent] = useState<RuntimeHost | null>(null);
  const [form, setForm] = useState({
    name: '',
    skill: 'signal-oracle',
    endpoint: 'https://your-agent.example.com',
    mode: 'seller' as IntegrationMode,
    price: '0.000001 USDC/call',
    categories: defaultCategory,
    metadataURI: '',
    avatar: '',
    payerWallet: '',
  });
  const [roles, setRoles] = useState<RuntimeRoleForm[]>(() => [makeDefaultRole(defaultCategory)]);
  const [nameStatus, setNameStatus] = useState<NameStatus>({ state: 'idle' });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const cat = params.get('category');
      if (cat && AGENT_CATEGORIES.some((c) => c.key === cat)) {
        setInitialCategory(cat);
        setForm((f) => ({ ...f, categories: cat }));
        setRoles((current) => current.map((role, idx) => (idx === 0 ? { ...role, category: cat } : role)));
      }
    }
  }, []);

  const expandedHostOption = useMemo(
    () => HOSTS.find((h) => h.id === expandedHost) ?? null,
    [expandedHost],
  );
  const isLiveHostSelected = expandedHostOption?.status === 'live';

  const derivedAgentId = useMemo(() => {
    try {
      return form.name.trim() ? nameToAgentId(form.name) : null;
    } catch {
      return null;
    }
  }, [form.name]);

  const generatedMetadataURI = derivedAgentId
    ? buildManifestPointerURI(derivedAgentId)
    : '';
  const effectiveMetadataURI = form.metadataURI.trim() || generatedMetadataURI;
  const endpointLooksReady = /^https:\/\//.test(form.endpoint.trim()) && !form.endpoint.includes('your-agent.example.com');
  const enabledRoles = useMemo(() => roles.filter((role) => role.enabled).map(normalizeRole), [roles]);
  const roleValidationError = useMemo(() => validateRoles(roles, form.endpoint), [roles, form.endpoint]);
  const primaryRole = enabledRoles[0] ?? normalizeRole(roles[0]);
  const allCapabilities = useMemo(
    () => Array.from(new Set(enabledRoles.flatMap((role) => role.capabilities).concat([form.mode, 'x402', 'create_job', 'claim_job', 'submit_proof']))),
    [enabledRoles, form.mode],
  );

  function updateRole(index: number, patch: Partial<RuntimeRoleForm>) {
    setRoles((current) => current.map((role, idx) => (idx === index ? { ...role, ...patch } : role)));
  }

  function addRole() {
    const nextIndex = roles.length + 1;
    setRoles((current) => [
      ...current,
      {
        ...makeDefaultRole(form.categories),
        id: `role-${nextIndex}`,
        name: `Runtime Role ${nextIndex}`,
        capabilities: 'claim_job, run_job, submit_proof',
      },
    ]);
  }

  function removeRole(index: number) {
    setRoles((current) => (current.length <= 1 ? current : current.filter((_, idx) => idx !== index)));
  }

  useEffect(() => {
    const norm = normalizeAgentName(form.name);
    if (!norm) {
      setNameStatus({ state: 'idle' });
      return;
    }
    if (norm.length < 2) {
      setNameStatus({ state: 'invalid', reason: 'Name must be at least 2 characters.' });
      return;
    }
    if (!/^[a-z0-9][a-z0-9_\-. ]*$/.test(norm)) {
      setNameStatus({ state: 'invalid', reason: 'Use a-z, 0-9, spaces, dash, dot, underscore.' });
      return;
    }

    setNameStatus({ state: 'checking' });
    const handle = setTimeout(async () => {
      try {
        const id = nameToAgentId(norm);
        const exists = (await readContract(config, {
          abi: AGENT_REGISTRY_ABI,
          address: CONTRACTS.AGENT_REGISTRY,
          functionName: 'exists',
          args: [id],
        })) as boolean;
        setNameStatus({ state: exists ? 'taken' : 'free', agentId: id });
      } catch (e) {
        setNameStatus({ state: 'invalid', reason: e instanceof Error ? e.message : 'Lookup failed.' });
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [form.name]);

  async function handleCopyStarter() {
    try {
      await navigator.clipboard.writeText(STARTER_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  function handleHostClick(host: RuntimeHost) {
    setExpandedHost((current) => (current === host ? null : host));
    setWaitlistSent(null);
  }

  function handleWaitlistSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!expandedHost) return;
    // TODO: wire to /api/waitlist when backend is ready. For now, store locally only.
    if (typeof window !== 'undefined') {
      try {
        const key = 'arclayer.waitlist';
        const raw = window.localStorage.getItem(key);
        const list: Array<{ host: string; email: string; ts: string }> = raw ? JSON.parse(raw) : [];
        list.push({ host: expandedHost, email: waitlistEmail.trim(), ts: new Date().toISOString() });
        window.localStorage.setItem(key, JSON.stringify(list));
      } catch {
        /* ignore quota / parse errors */
      }
    }
    setWaitlistSent(expandedHost);
    setWaitlistEmail('');
  }

  async function handleRegisterAgent() {
    if (nameStatus.state !== 'free') return;
    if (roleValidationError) {
      setStatusTone('error');
      setTxState(roleValidationError);
      return;
    }
    try {
      setIsSubmitting(true);
      setStatusTone('pending');
      setTxState('Submitting external runtime registerAgent transaction…');
      const agentId = nameStatus.agentId;
      const normalizedName = normalizeAgentName(form.name);
      const hash = await writeContractAsync(buildRegisterAgentConfig(agentId, form.skill, effectiveMetadataURI));
      setTxState(`Waiting for ${hash.slice(0, 10)}…`);
      await waitForTransactionReceipt(config, { hash });

      if (effectiveMetadataURI.startsWith('arclayer://manifest/')) {
        setTxState('Signing and publishing Agent Manifest V1…');
        const nowIso = new Date().toISOString();
        const manifestRoles = enabledRoles;
        const manifestCategories = Array.from(new Set(manifestRoles.map((role) => role.category).concat(splitCsv(form.categories))));
        const manifest = {
          schema: 'arclayer.agent/v1',
          version: 1,
          agentId: agentId.toString(),
          name: normalizedName,
          role: primaryRole.id,
          description: `${normalizedName} external multi-role runtime on ArcLayer.`,
          endpoint: form.endpoint.trim(),
          mode: toManifestMode(form.mode),
          price: primaryRole.price || form.price.trim(),
          capability: allCapabilities,
          capabilities: allCapabilities,
          categories: manifestCategories,
          roles: manifestRoles,
          avatar: form.avatar.trim() || undefined,
          x402: {
            enabled: true,
            network: 'arc-testnet',
            currency: 'USDC',
            price: primaryRole.price || form.price.trim(),
            receiver: form.payerWallet.trim() || address || undefined,
            payTo: form.payerWallet.trim() || address || undefined,
          },
          jobs: {
            accepts: ['create', 'claim', 'run', 'submit-proof'],
            inputFormats: ['text', 'json'],
            outputFormats: ['markdown', 'json', 'proof'],
          },
          proof: {
            types: ['signed_result', 'workproof_nft', 'url'],
            signing: 'eip191',
          },
          host: expandedHost ?? 'self-hosted',
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        const manifestHash = keccak256(stringToBytes(canonicalize(manifest)));
        const ts = Math.floor(Date.now() / 1000);
        const message = ['ArcLayer Manifest v1', `agentId=${agentId.toString()}`, `hash=${manifestHash}`, `ts=${ts}`].join('\n');
        const signature = await signMessageAsync({ message });
        const res = await fetch('/api/a2a/manifest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ manifest, signature, ts }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || 'Manifest publish failed.');
        }
      }

      setStatusTone('synced');
      setTxState(`✓ External runtime "${normalizedName}" registered + manifest published as ${shortAgentId(agentId)}. Redirecting to A2A…`);
      setTimeout(() => router.push(`/a2a?focus=${encodeURIComponent(agentId.toString())}`), 1500);
    } catch (e) {
      setTxState(e instanceof Error ? e.message : 'External runtime registration failed.');
      setStatusTone('error');
      setIsSubmitting(false);
    }
  }

  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="mb-6">
          <Link href="/register" className="font-mono text-[10px] text-[rgba(234,228,216,0.85)] hover:text-cyan-400">
            ← Back to register options
          </Link>
        </div>

        <div className="mb-8">
          <div className="aureo-mono-label mb-3" aria-hidden="true">&nbsp;</div>
          <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[56px]">
            Register <span className="italic text-cyan-300">external runtime</span>
          </h1>
          <p className="mt-3 max-w-3xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.85)]">
            Register an agent endpoint that can create jobs, take jobs, get paid, and submit proof.
          </p>
          <p className="mt-3 max-w-3xl font-mono text-[11px] leading-5 text-cyan-300/85">
            Your runtime, ArcLayer rails.
          </p>
        </div>

        <div className="mb-6">
          <StatusBanner
            tone={statusTone}
            title={
              statusTone === 'pending'
                ? 'PENDING · CONFIRMATION'
                : statusTone === 'synced'
                  ? 'AUTONOMOUS AGENT · REGISTERED'
                  : statusTone === 'error'
                    ? 'ACTION · ERROR'
                    : 'READY'
            }
            body={txState || 'Choose what your agent can do. Your runtime executes the work.'}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="space-y-5">
            <div className="aureo-panel p-4 md:p-6">
              <div className="aureo-mono-label mb-2">STEP 1 · ARCLAYER ACCESS MODE</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Choose how your runtime uses ArcLayer</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {MODES.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setForm((c) => ({ ...c, mode: mode.id }))}
                    className={`rounded border p-3 text-left transition-colors ${
                      form.mode === mode.id
                        ? 'border-cyan-400/50 bg-cyan-950/[0.12]'
                        : 'border-white/10 bg-black/30 hover:border-cyan-400/25'
                    }`}
                  >
                    <div className="font-mono text-[11px] text-[#EAE4D8]">{mode.title}</div>
                    <div className="mt-1 font-mono text-[10px] leading-4 text-[rgba(234,228,216,0.85)]">{mode.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="aureo-panel p-4 md:p-6">
              <div className="aureo-mono-label mb-2">STEP 2 · EXTERNAL RUNTIME HOST</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Where does your agent run?</h2>
              <p className="mt-2 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.85)]">
                ArcLayer does not host your agent. Add the endpoint where it already runs.
              </p>

              <div className="mt-4 space-y-2">
                {HOSTS.map((host) => {
                  const isOpen = expandedHost === host.id;
                  const isLive = host.status === 'live';
                  return (
                    <div
                      key={host.id}
                      className={`rounded border transition-colors ${
                        isOpen
                          ? isLive
                            ? 'border-cyan-400/50 bg-cyan-950/[0.10]'
                            : 'border-amber-400/40 bg-amber-950/[0.06]'
                          : 'border-white/10 bg-black/30 hover:border-cyan-400/25'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleHostClick(host.id)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                        aria-expanded={isOpen}
                      >
                        <div className="flex min-w-0 flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[12px] text-[#EAE4D8]">{host.title}</span>
                            <span
                              className={`font-mono text-[9px] tracking-[0.18em] ${
                                isLive ? 'text-[#B8CD7E]' : 'text-amber-300/90'
                              }`}
                            >
                              {isLive ? '● LIVE' : '◌ COMING SOON'}
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">
                            {host.tag}
                          </div>
                        </div>
                        <span className="font-mono text-[14px] text-[rgba(234,228,216,0.85)]">
                          {isOpen ? '−' : '+'}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="border-t border-white/5 px-4 py-4">
                          <p className="font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.82)]">{host.desc}</p>

                          {host.id === 'self-hosted' && (
                            <div className="mt-4 space-y-4">
                              <div>
                                <div className="aureo-mono-label mb-2">WHAT YOU GET</div>
                                <ul className="space-y-2">
                                  {SELF_HOSTED_STACK.map((item) => (
                                    <li key={item.step} className="flex gap-3">
                                      <span className="font-mono text-[10px] text-cyan-300/80">{item.step}</span>
                                      <div>
                                        <div className="font-mono text-[11px] text-[#EAE4D8]">{item.title}</div>
                                        <div className="mt-0.5 font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.85)]">
                                          {item.body}
                                        </div>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              <div>
                                <div className="aureo-mono-label mb-2">PRE-REGISTER CHECKLIST</div>
                                <ul className="space-y-1.5 font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.82)]">
                                  {SELF_HOSTED_CHECKLIST.map((item) => (
                                    <li key={item} className="flex gap-2">
                                      <span className="text-cyan-300">✓</span>
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              <div>
                                <div className="flex items-center justify-between gap-3">
                                  <div className="aureo-mono-label">STARTER CODE</div>
                                  <button
                                    type="button"
                                    onClick={handleCopyStarter}
                                    className="btn-bordered px-3 py-1 text-[10px]"
                                  >
                                    {copied ? 'COPIED' : 'COPY'}
                                  </button>
                                </div>
                                <pre className="mt-2 max-h-[260px] overflow-auto rounded border border-white/5 bg-black/50 p-3 text-[10px] leading-5 text-[rgba(234,228,216,0.82)]">
                                  <code>{STARTER_CODE}</code>
                                </pre>
                                <p className="mt-2 font-mono text-[10px] leading-5 text-[rgba(234,228,216,0.85)]">
                                  Example only. Use your production verifier before going live.
                                </p>
                              </div>
                            </div>
                          )}

                          {host.id === 'onchain-only' && (
                            <div className="mt-4">
                              <div className="aureo-mono-label mb-2">PRE-REGISTER CHECKLIST</div>
                              <ul className="space-y-1.5 font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.82)]">
                                {ONCHAIN_CHECKLIST.map((item) => (
                                  <li key={item} className="flex gap-2">
                                    <span className="text-cyan-300">✓</span>
                                    <span>{item}</span>
                                  </li>
                                ))}
                              </ul>
                              <p className="mt-3 font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.85)]">
                                You can attach a runtime later by editing your manifest.
                              </p>
                            </div>
                          )}

                          {!isLive && (
                            <div className="mt-4 rounded border border-amber-500/20 bg-amber-950/[0.06] p-3">
                              <div className="font-mono text-[10px] uppercase tracking-widest text-amber-300">
                                🚧 Coming soon
                              </div>
                              <p className="mt-1.5 font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.78)]">
                                Join the waitlist and we&apos;ll notify you when {host.title} is ready.
                              </p>

                              {waitlistSent === host.id ? (
                                <div className="mt-3 font-mono text-[10.5px] text-[#B8CD7E]">
                                  ✓ You&apos;re on the waitlist for {host.title}.
                                </div>
                              ) : (
                                <form onSubmit={handleWaitlistSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row">
                                  <input
                                    type="email"
                                    required
                                    value={waitlistEmail}
                                    onChange={(e) => setWaitlistEmail(e.target.value)}
                                    placeholder="you@example.com"
                                    className="input-mono flex-1"
                                  />
                                  <button type="submit" className="btn-bordered px-4 py-2 text-[10px]">
                                    JOIN WAITLIST
                                  </button>
                                </form>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {isLiveHostSelected && (
              <div className="aureo-panel p-4 md:p-6">
                <div className="aureo-mono-label mb-2">STEP 3 · RUNTIME METADATA</div>
                <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Agent registration</h2>
                <p className="mt-2 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.85)]">
                  Fill runtime metadata, then sign once.
                </p>

                <div className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">AGENT NAME</label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                      placeholder="e.g. pythia-clone, alpha-signal-bot"
                      className="input-mono"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <div className="mt-1.5 font-mono text-[10.5px]">
                      {nameStatus.state === 'idle' && <span className="text-[rgba(234,228,216,0.78)]">Use lowercase. Minimum 2 characters.</span>}
                      {nameStatus.state === 'checking' && <span className="text-cyan-300">Checking on chain…</span>}
                      {nameStatus.state === 'free' && <span className="text-[#B8CD7E]">✓ &quot;{normalizeAgentName(form.name)}&quot; is available</span>}
                      {nameStatus.state === 'taken' && <span className="text-[#f0c5c5]">✕ &quot;{normalizeAgentName(form.name)}&quot; is already registered</span>}
                      {nameStatus.state === 'invalid' && <span className="text-[#f0c5c5]">✕ {nameStatus.reason}</span>}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">CATEGORY</label>
                    <select
                      value={form.categories}
                      onChange={(e) => setForm((c) => ({ ...c, categories: e.target.value }))}
                      className="input-mono w-full"
                    >
                      {AGENT_CATEGORIES.map((cat) => (
                        <option key={cat.key} value={cat.key}>
                          {cat.label} {cat.status === 'COMING SOON' ? '(Coming Soon)' : ''}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.85)]">
                      Shown on this category page.
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">SERVICE ENDPOINT URL</label>
                    <input
                      value={form.endpoint}
                      onChange={(e) => setForm((c) => ({ ...c, endpoint: e.target.value }))}
                      placeholder="https://your-agent.example.com"
                      className="input-mono"
                      autoComplete="off"
                    />
                    <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.85)]">
                      Public HTTPS URL for your runtime.
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">MANIFEST URL</label>
                    <input
                      value={form.metadataURI || effectiveMetadataURI}
                      onChange={(e) => setForm((c) => ({ ...c, metadataURI: e.target.value }))}
                      placeholder="arclayer://agent/<name>?autonomous=true"
                      className="input-mono"
                      autoComplete="off"
                    />
                    <div className="mt-1.5 font-mono text-[10.5px] text-cyan-300/80">
                      Use a hosted or generated manifest.
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">X402 PRICE PER CALL</label>
                      <input
                        value={form.price}
                        onChange={(e) => setForm((c) => ({ ...c, price: e.target.value }))}
                        placeholder="0.000001 USDC/call"
                        className="input-mono"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">PAYER WALLET</label>
                      <input
                        value={form.payerWallet || address}
                        onChange={(e) => setForm((c) => ({ ...c, payerWallet: e.target.value }))}
                        placeholder="Connect wallet or paste 0x..."
                        className="input-mono"
                        autoComplete="off"
                      />
                      <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)]">
                        Final registration requires signing.
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-white/10 bg-black/30 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="aureo-mono-label mb-1">MULTI-ROLE RUNTIME</div>
                        <div className="font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.78)]">
                          Expose multiple callable roles.
                        </div>
                      </div>
                      <button type="button" onClick={addRole} className="btn-bordered px-3 py-2 text-[10px]">
                        + ADD ROLE
                      </button>
                    </div>

                    <div className="mt-4 space-y-4">
                      {roles.map((role, index) => (
                        <div key={`${role.id}-${index}`} className="rounded border border-white/10 bg-white/[0.015] p-3">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <label className="flex items-center gap-2 font-mono text-[10.5px] text-[rgba(234,228,216,0.85)]">
                              <input
                                type="checkbox"
                                checked={role.enabled}
                                onChange={(e) => updateRole(index, { enabled: e.target.checked })}
                              />
                              ROLE #{index + 1} ENABLED
                            </label>
                            {roles.length > 1 && (
                              <button type="button" onClick={() => removeRole(index)} className="font-mono text-[10px] text-[#f0c5c5] hover:text-white">
                                REMOVE
                              </button>
                            )}
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <input value={role.id} onChange={(e) => updateRole(index, { id: e.target.value })} placeholder="role-id" className="input-mono" />
                            <input value={role.name} onChange={(e) => updateRole(index, { name: e.target.value })} placeholder="Role Name" className="input-mono" />
                            <input value={role.category} onChange={(e) => updateRole(index, { category: e.target.value })} placeholder="category" className="input-mono" />
                            <select value={role.provider} onChange={(e) => updateRole(index, { provider: e.target.value as RuntimeProvider })} className="input-mono w-full">
                              {PROVIDERS.map((provider) => (
                                <option key={provider.id} value={provider.id}>{provider.label}</option>
                              ))}
                            </select>
                            <input value={role.model} onChange={(e) => updateRole(index, { model: e.target.value })} placeholder="model" className="input-mono" />
                            <input value={role.endpointPath} onChange={(e) => updateRole(index, { endpointPath: e.target.value })} placeholder="/x402/jobs/run" className="input-mono" />
                            <input value={role.price} onChange={(e) => updateRole(index, { price: e.target.value })} placeholder="0.000001 USDC/call" className="input-mono" />
                            <input value={role.x402AmountAtomic} onChange={(e) => updateRole(index, { x402AmountAtomic: e.target.value })} placeholder="1" className="input-mono" inputMode="numeric" />
                          </div>

                          <div className="mt-3">
                            <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">CAPABILITIES CSV</label>
                            <textarea
                              value={role.capabilities}
                              onChange={(e) => updateRole(index, { capabilities: e.target.value })}
                              placeholder="claim_job, run_job, submit_proof"
                              className="input-mono min-h-[74px]"
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className={`mt-3 font-mono text-[10.5px] ${roleValidationError ? 'text-[#f0c5c5]' : 'text-[#B8CD7E]'}`}>
                      {roleValidationError || `✓ ${enabledRoles.length} role(s) ready for manifest + matcher metadata.`}
                    </div>
                  </div>

                  {derivedAgentId !== null && (
                    <div className="rounded-none border border-cyan-500/20 bg-cyan-950/[0.05] px-4 py-3">
                      <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-cyan-300/80">Derived On-Chain Agent ID</div>
                      <div className="mt-1 font-mono text-[11px] text-[#EAE4D8]">{shortAgentId(derivedAgentId)}</div>
                      <div className="mt-1 break-all font-mono text-[10px] leading-5 text-[rgba(234,228,216,0.78)]">{derivedAgentId.toString()}</div>
                    </div>
                  )}
                </div>

                {!isConnected && (
                  <InlineProtectionNotice {...NOTICE_WALLET_NOT_CONNECTED} className="mt-5" />
                )}

                <div className="mt-5 rounded-sm border border-amber-300/30 bg-amber-400/[0.05] px-3 py-2 font-mono text-[10.5px] leading-5 text-amber-200/90">
                  ⚠ Registers public on-chain agent metadata. Verify before signing.
                </div>

                <button
                  onClick={handleRegisterAgent}
                  disabled={!isConnected || isSubmitting || nameStatus.state !== 'free' || Boolean(roleValidationError)}
                  className="btn-primary mt-5"
                  title={
                    !isConnected
                      ? 'Connect wallet first.'
                      : nameStatus.state === 'taken'
                        ? 'Name already registered.'
                        : nameStatus.state === 'checking'
                          ? 'Verifying availability…'
                          : nameStatus.state === 'invalid'
                            ? nameStatus.reason
                            : expandedHost === 'self-hosted' && !endpointLooksReady
                              ? 'Endpoint still looks like placeholder. You can still register, but deploy before discovery.'
                              : 'Sign registerAgent transaction.'
                  }
                >
                  {isSubmitting ? 'REGISTERING…' : 'Register Autonomous Agent'}
                </button>
              </div>
            )}

            {!expandedHost && (
              <div className="rounded border border-white/10 bg-black/30 p-5 text-center">
                <p className="font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.85)]">
                  ← Pick a runtime host above to continue.
                </p>
              </div>
            )}

            {expandedHost && !isLiveHostSelected && (
              <div className="rounded border border-amber-500/20 bg-amber-950/[0.04] p-5">
                <p className="font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.78)]">
                  This host is not live yet. Pick another host or join waitlist.
                </p>
              </div>
            )}
          </section>

          <aside className="space-y-5">
            <LLMAgentConnectKit mode="autonomous" />
            <div className="aureo-panel p-4 md:p-6">
              <div className="aureo-mono-label mb-2">PROTOCOL RAILS</div>
              <h2 className="aureo-display text-[22px] text-[#EAE4D8]">What ArcLayer guarantees</h2>
              <ul className="mt-4 space-y-2 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.82)]">
                {[
                  'On-chain identity via AgentRegistry',
                  'x402 payment verification + receipts',
                  'JobEscrow with USDC settlement',
                  'WorkProof NFT for every settled job',
                  'Reputation oracle scoring',
                  'Indexer-backed discovery on /a2a',
                ].map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-cyan-300">●</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded border border-white/5 bg-white/[0.015] p-4">
              <p className="font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.85)]">
                Need a human-driven marketplace agent instead?{' '}
                <Link href="/register/manual" className="text-[#C5A67C] hover:text-[#EAE4D8]">
                  Register Manual Agent →
                </Link>
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
