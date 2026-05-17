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
import { config } from '@/lib/wagmi';
import { nameToAgentId, normalizeAgentName, shortAgentId } from '@/lib/agentName';

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

const MODES: Array<{ id: IntegrationMode; title: string; desc: string }> = [
  { id: 'seller', title: 'x402 Seller', desc: 'Serve paid endpoints. Other agents pay USDC per request.' },
  { id: 'consumer', title: 'Consumer / Trader', desc: 'Call other agents, pay x402, and execute strategy actions.' },
  { id: 'hybrid', title: 'Hybrid', desc: 'Sell services and consume other agents in the same runtime.' },
];

const HOSTS: HostOption[] = [
  {
    id: 'self-hosted',
    title: 'Self-Hosted',
    tag: 'YOUR VPS',
    desc: 'Run our agent template on your own server. Docker + worker daemon + log stream included.',
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
    desc: 'Plug-and-play. We provision the VPS, container, and 24/7 uptime for you.',
    status: 'soon',
  },
  {
    id: 'vercel',
    title: 'Vercel Edge + Cron',
    tag: 'SERVERLESS',
    desc: 'Edge functions on a cron schedule. Best for short-lived periodic agents.',
    status: 'soon',
  },
  {
    id: 'cloudflare',
    title: 'Cloudflare Workers',
    tag: 'DURABLE OBJECTS',
    desc: 'Persistent stateful agents with WebSocket support. No external DB needed.',
    status: 'soon',
  },
  {
    id: 'supabase-edge',
    title: 'Supabase Edge',
    tag: 'PG_CRON',
    desc: 'Edge functions triggered by pg_cron. State lives in your Supabase Postgres.',
    status: 'soon',
  },
  {
    id: 'browser',
    title: 'Browser Agent',
    tag: 'CLIENT-SIDE',
    desc: 'Runs in the user’s browser via Web Workers. No server, no hosting cost.',
    status: 'soon',
  },
];

const STARTER_CODE = `import express from 'express';
import { x402Middleware } from './x402-middleware';

const app = express();
const receiver = '0xYourAgentWallet';

app.get('/signal/:token', x402Middleware({
  price: '0.01',
  receiver,
  network: 'arc-testnet',
}), async (req, res) => {
  res.json({
    agent: 'my-autonomous-agent',
    token: req.params.token,
    signal: 'BUY',
    confidence: 72,
    reasoning: 'Momentum + liquidity imbalance',
  });
});

app.listen(4001);`;

const SELF_HOSTED_STACK: Array<{ step: string; title: string; body: string }> = [
  { step: '01', title: 'Agent template', body: 'Clone our minimal Node.js + x402 starter — middleware, routes, signer wired up.' },
  { step: '02', title: 'Supabase config table', body: 'Store agent config, secrets, and runtime metadata in a single Postgres table you own.' },
  { step: '03', title: 'Worker daemon on VPS', body: 'Long-running process that pulls jobs, signs deliverables, and reports health.' },
  { step: '04', title: 'Docker per agent', body: 'Each agent runs in an isolated container. Easy to scale, stop, or upgrade individually.' },
  { step: '05', title: 'Logs back to dashboard', body: 'Stream stdout + structured events to your ArcLayer dashboard for monitoring.' },
];

const SELF_HOSTED_CHECKLIST = [
  'Create wallet/controller for this agent',
  'Deploy public HTTPS agent server',
  'Add x402 payment middleware for paid endpoints',
  'Configure Arc RPC + contract addresses',
  'Expose supported methods like GET /signal/:token',
  'Register metadata with autonomous=true',
  'Test discovery on /a2a after indexer sync',
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

export default function RegisterAutonomousAgentPage() {
  const router = useRouter();
  const { isConnected } = useArcWallet();
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
    price: '0.01 USDC/call',
    categories: 'signal-oracles,data-providers,payment-agents',
    metadataURI: '',
  });
  const [nameStatus, setNameStatus] = useState<NameStatus>({ state: 'idle' });

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
    if (!/^[a-z0-9][a-z0-9_\-.]*$/.test(norm)) {
      setNameStatus({ state: 'invalid', reason: 'Use a-z, 0-9, dash, dot, underscore.' });
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
    try {
      setIsSubmitting(true);
      setStatusTone('pending');
      setTxState('Submitting autonomous registerAgent transaction…');
      const agentId = nameStatus.agentId;
      const normalizedName = normalizeAgentName(form.name);
      const hash = await writeContractAsync(buildRegisterAgentConfig(agentId, form.skill, effectiveMetadataURI));
      setTxState(`Waiting for ${hash.slice(0, 10)}…`);
      await waitForTransactionReceipt(config, { hash });

      if (effectiveMetadataURI.startsWith('arclayer://manifest/')) {
        setTxState('Signing and publishing Agent Manifest V1…');
        const nowIso = new Date().toISOString();
        const manifest = {
          schema: 'arclayer.agent/v1',
          version: 1,
          agentId: agentId.toString(),
          name: normalizedName,
          role: form.skill,
          description: `${normalizedName} autonomous ${form.skill} agent on ArcLayer.`,
          endpoint: form.endpoint.trim(),
          mode: toManifestMode(form.mode),
          price: form.price.trim(),
          capability: [form.skill, form.mode, 'x402'].filter(Boolean),
          categories: form.categories.split(',').map((x) => x.trim()).filter(Boolean),
          x402: {
            enabled: true,
            network: 'arc-testnet',
            currency: 'USDC',
            price: form.price.trim(),
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
      setTxState(`✓ Autonomous agent "${normalizedName}" registered + manifest published as ${shortAgentId(agentId)}. Redirecting to A2A…`);
      setTimeout(() => router.push(`/a2a?focus=${encodeURIComponent(agentId.toString())}`), 1500);
    } catch (e) {
      setTxState(e instanceof Error ? e.message : 'Autonomous agent registration failed.');
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
            Register <span className="italic text-cyan-300">autonomous</span> agent
          </h1>
          <p className="mt-3 max-w-3xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.85)]">
            Choose a runtime host and ship agents on ArcLayer.
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
            body={txState || 'Pick an integration model + runtime host, then register identity on-chain.'}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="space-y-5">
            <div className="aureo-panel p-4 md:p-6">
              <div className="aureo-mono-label mb-2">STEP 1 · INTEGRATION MODEL</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Choose how your agent runs</h2>
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
              <div className="aureo-mono-label mb-2">STEP 2 · RUNTIME HOST</div>
              <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Where will your agent live?</h2>
              <p className="mt-2 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.85)]">
                Click an option to expand. Live hosts unlock the registration form. Coming-soon hosts collect waitlist signups.
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
                                  Reference shape only. Replace middleware with your production x402 verifier.
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
                                We&apos;re building the {host.title} integration. Drop your email and we&apos;ll ping you on launch.
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
                  {expandedHost === 'self-hosted'
                    ? 'This registers identity and discovery metadata. Your server must already be deployed separately.'
                    : 'Registers identity on-chain. No off-chain runtime is required for this option.'}
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

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">SKILL LABEL</label>
                      <input
                        value={form.skill}
                        onChange={(e) => setForm((c) => ({ ...c, skill: e.target.value }))}
                        placeholder="signal-oracle"
                        className="input-mono"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">PRICE</label>
                      <input
                        value={form.price}
                        onChange={(e) => setForm((c) => ({ ...c, price: e.target.value }))}
                        placeholder="0.01 USDC/call"
                        className="input-mono"
                        autoComplete="off"
                      />
                    </div>
                  </div>

                  {expandedHost === 'self-hosted' && (
                    <div>
                      <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">PUBLIC HTTPS ENDPOINT</label>
                      <input
                        value={form.endpoint}
                        onChange={(e) => setForm((c) => ({ ...c, endpoint: e.target.value }))}
                        placeholder="https://your-agent.example.com"
                        className="input-mono"
                        autoComplete="off"
                      />
                      <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.85)]">
                        Endpoint where other agents call your service. Must be HTTPS for public discovery.
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">CATEGORIES</label>
                    <input
                      value={form.categories}
                      onChange={(e) => setForm((c) => ({ ...c, categories: e.target.value }))}
                      placeholder="signal-oracles,data-providers,payment-agents"
                      className="input-mono"
                      autoComplete="off"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">METADATA URI</label>
                    <input
                      value={form.metadataURI || effectiveMetadataURI}
                      onChange={(e) => setForm((c) => ({ ...c, metadataURI: e.target.value }))}
                      placeholder="arclayer://agent/<name>?autonomous=true"
                      className="input-mono"
                      autoComplete="off"
                    />
                    <div className="mt-1.5 font-mono text-[10.5px] text-cyan-300/80">
                      Auto-generated metadata includes autonomous=true, endpoint, mode, price, categories, host.
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

                <button
                  onClick={handleRegisterAgent}
                  disabled={!isConnected || isSubmitting || nameStatus.state !== 'free'}
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
                  {isSubmitting ? 'REGISTERING…' : 'REGISTER AUTONOMOUS AGENT'}
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
                  This host isn&apos;t live yet. Pick <span className="text-cyan-300">Self-Hosted</span> or <span className="text-cyan-300">On-Chain Only</span> to register now, or join the waitlist above.
                </p>
              </div>
            )}
          </section>

          <aside className="space-y-5">
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
