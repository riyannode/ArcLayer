'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useSignMessage } from 'wagmi';
import { switchChain } from '@wagmi/core';
import { loadAgentDetail } from '@/lib/indexer';
import {
  fetchErc8183Metadata,
  getErc8183Capabilities,
  getErc8183Avatar,
  displayCategory,
  roleLabel,
  shortText,
} from '@/lib/erc8183/agent-profile';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useArcWrite } from '@/hooks/useArcWrite';
import { CONTRACTS, ERC8183_AGENTIC_COMMERCE_ABI } from '@arclayer/sdk';
import { config } from '@/lib/wagmi';
import { X402ActionGate } from '@/components/x402/X402ActionGate';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type SectionKey = 'provider' | 'client' | 'task' | 'scope' | 'budget' | 'review';

type LinkedAgent = {
  agentId: string;
  tokenId: string;
  controller: string;
  metadataName?: string;
};

type SessionStatus = {
  authenticated: boolean;
  wallet?: string;
  expiresAt?: number;
  linkedAgents: LinkedAgent[];
};

type FormState = {
  buyerAgentId: string;
  description: string;
  deliverables: string;
  requirements: string;
  timeline: string;
  budgetMax: string;
  evaluatorMode: 'client' | 'explicit';
  evaluatorAgentId: string;
};

const emptyForm: FormState = {
  buyerAgentId: '',
  description: '',
  deliverables: '',
  requirements: '',
  timeline: '',
  budgetMax: '',
  evaluatorMode: 'client',
  evaluatorAgentId: '',
};

const DRAFT_KEY = 'arclayer:direct-hire-draft';

/* ------------------------------------------------------------------ */
/*  Primitives                                                         */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: 'Complete' | 'Pending' }) {
  return (
    <span
      className={
        status === 'Complete'
          ? 'rounded-md border border-[#B8CD7E]/20 bg-[#B8CD7E]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#B8CD7E]'
          : 'rounded-md border border-[#F3C536]/20 bg-[#F3C536]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#F3C536]'
      }
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

        <div className="flex shrink-0 items-center gap-3">
          <StatusBadge status={status} />
          <span className="select-none text-2xl text-[#EAE4D8]/75">
            {open ? '⌃' : '⌄'}
          </span>
        </div>
      </button>

      {open ? (
        <div className="border-t border-white/[0.04] px-7 pb-7 pt-6">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseAgentId(value: string | undefined) {
  return value && /^\d+$/.test(value) ? value : null;
}

function timelineToSeconds(timeline: string): number {
  switch (timeline) {
    case '24 hours': return 24 * 60 * 60;
    case '3 days': return 3 * 24 * 60 * 60;
    case '7 days': return 7 * 24 * 60 * 60;
    case '14 days': return 14 * 24 * 60 * 60;
    case '30 days': return 30 * 24 * 60 * 60;
    default: return 7 * 24 * 60 * 60;
  }
}

function usdcToAtomic(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) return '0';
  return String(Math.round(num * 1e6));
}

/* ------------------------------------------------------------------ */
/*  Prepare result type                                                */
/* ------------------------------------------------------------------ */

type PrepareResult = {
  ok: true;
  prepareId: string;
  settlementMode: string;
  participants: {
    client: { agentId: string; controller: string };
    provider: { agentId: string; controller: string };
    evaluator: { agentId: string; controller: string; mode: string };
  };
  budget: { atomic: string; decimals: number; formatted: string };
  expiry: { expiredAtUnix: string; isExpired: boolean };
  inputPayloadHash: string;
  description: string;
  next: {
    createJob: {
      signer: string;
      provider: string;
      evaluator: string;
      expiredAt: string;
      description: string;
      hook: string;
    };
  };
};

type CreatedResult = {
  ok: true;
  localJobId: string;
  erc8183JobId: string;
  createTxHash: string;
  status: string;
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function DirectHireEscrowPage() {
  const params = useParams<{ id: string }>();
  const { address, isConnected } = useArcWallet();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useArcWrite();
  const agentId = parseAgentId(params.id);

  /* ---- Wallet session state ---- */
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState('');

  /* ---- Agent state ---- */
  const [agentData, setAgentData] = useState<{
    agentId: string;
    name: string;
    controller: string;
    category: string;
    role: string;
    capabilities: string[];
    avatar: string;
    description: string;
    identityStatus: string;
  } | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);
  const [agentError, setAgentError] = useState<string | null>(null);

  /* ---- Form state ---- */
  const [form, setForm] = useState<FormState>(emptyForm);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    provider: true,
    client: false,
    task: false,
    scope: false,
    budget: false,
    review: false,
  });

  const [preparing, setPreparing] = useState(false);
  const [prepareResult, setPrepareResult] = useState<PrepareResult | null>(null);
  const [signing, setSigning] = useState(false);
  const [signTxState, setSignTxState] = useState('');
  const [createdResult, setCreatedResult] = useState<CreatedResult | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  /* ---- Fetch wallet session ---- */
  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      const data: SessionStatus = await res.json();
      setSession(data);
    } catch {
      setSession({ authenticated: false, linkedAgents: [] });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSessionLoading(true);
      try {
        const res = await fetch('/api/auth/session', { cache: 'no-store' });
        const data: SessionStatus = await res.json();
        if (!cancelled) setSession(data);
      } catch {
        if (!cancelled) setSession({ authenticated: false, linkedAgents: [] });
      } finally {
        if (!cancelled) setSessionLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchSession]);

  /* ---- Sign in with wallet ---- */
  async function handleSignIn() {
    if (!address) return;
    setSigningIn(true);
    setSignInError('');

    try {
      // 1. Get nonce
      const nonceRes = await fetch(
        `/api/auth/wallet/nonce?address=${encodeURIComponent(address)}`,
      );
      const nonceData = await nonceRes.json();
      if (!nonceRes.ok || !nonceData.ok) {
        throw new Error(nonceData.detail || nonceData.error || 'Failed to get nonce');
      }

      // 2. Sign the message
      const signature = await signMessageAsync({
        message: nonceData.message,
      });

      // 3. Verify and create session
      const verifyRes = await fetch('/api/auth/wallet/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: address,
          nonce: nonceData.nonce,
          signature,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.ok) {
        throw new Error(verifyData.detail || verifyData.error || 'Signature verification failed');
      }

      // 4. Refresh session
      await fetchSession();
    } catch (e) {
      setSignInError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setSigningIn(false);
    }
  }

  /* ---- Logout ---- */
  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setSession({ authenticated: false, linkedAgents: [] });
      setForm((s) => ({ ...s, buyerAgentId: '' }));
    } catch {
      /* ignore */
    }
  }

  /* ---- Load agent from route param ---- */
  useEffect(() => {
    if (!agentId) {
      setAgentError('Invalid agent id.');
      setAgentLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        setAgentLoading(true);
        setAgentError(null);

        const { data } = await loadAgentDetail(agentId!);
        const metadata = await fetchErc8183Metadata(data.agent.metadataURI);
        const capabilities = getErc8183Capabilities(metadata);
        const avatar = getErc8183Avatar(metadata);

        if (cancelled) return;

        const displayName =
          metadata?.name || `Agent #${agentId}`;
        const category =
          displayCategory(metadata) || 'ERC-8183 Commerce';
        const role = roleLabel(metadata?.role || 'Worker');

        setAgentData({
          agentId: agentId!,
          name: displayName,
          controller: data.agent.controller,
          category,
          role,
          capabilities,
          avatar,
          description:
            metadata?.description ||
            'ERC-8183 commerce agent for escrow-backed work.',
          identityStatus: data.agent.controller ? 'Minted' : 'Unknown',
        });
      } catch (e) {
        if (!cancelled) {
          setAgentError(
            e instanceof Error ? e.message : 'Failed to load agent.',
          );
        }
      } finally {
        if (!cancelled) setAgentLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

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

  /* ---- Linked agents from session ---- */
  const linkedAgents: LinkedAgent[] = session?.authenticated
    ? session.linkedAgents
    : [];

  /* ---- Auto-select buyer if only one linked agent ---- */
  useEffect(() => {
    if (
      session?.authenticated &&
      linkedAgents.length === 1 &&
      !form.buyerAgentId
    ) {
      setForm((s) => ({ ...s, buyerAgentId: linkedAgents[0].agentId }));
    }
  }, [session?.authenticated, linkedAgents, form.buyerAgentId]);

  /* ---- Derived completion flags ---- */
  const taskComplete = Boolean(form.description.trim());
  const scopeComplete = Boolean(
    form.deliverables.trim() && form.requirements.trim() && form.timeline,
  );
  const budgetComplete = Boolean(form.budgetMax);
  const buyerComplete = Boolean(form.buyerAgentId);
  const evaluatorComplete =
    form.evaluatorMode === 'client' || Boolean(form.evaluatorAgentId.trim());
  const sessionReady = Boolean(session?.authenticated);
  const canPrepare =
    sessionReady &&
    taskComplete &&
    scopeComplete &&
    budgetComplete &&
    buyerComplete &&
    evaluatorComplete &&
    agentData;

  /* ---- Handlers ---- */
  function toggleSection(key: SectionKey) {
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setError('');
    setSuccess('');
    setPrepareResult(null);
    setCreatedResult(null);
    setForm((s) => ({ ...s, [key]: value }));
  }

  function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    setError('');
    setSuccess('Draft saved locally.');
  }

  async function handlePrepare() {
    if (!canPrepare || !agentData) return;

    try {
      setPreparing(true);
      setError('');
      setSuccess('');
      setPrepareResult(null);

      const expiredAtUnix = String(
        Math.floor(Date.now() / 1000) + timelineToSeconds(form.timeline),
      );
      const budgetAtomic = usdcToAtomic(form.budgetMax);

      const inputPayload = {
        description: form.description,
        deliverables: form.deliverables,
        requirements: form.requirements,
        source: 'direct-hire-escrow',
      };

      const body: Record<string, unknown> = {
        settlementMode: 'erc8183_escrow',
        buyerAgentId: form.buyerAgentId,
        providerAgentId: agentData.agentId,
        evaluatorMode: form.evaluatorMode,
        budgetAtomic,
        expiredAtUnix,
        description: form.description,
        inputPayload,
      };

      if (form.evaluatorMode === 'explicit' && form.evaluatorAgentId.trim()) {
        body.evaluatorAgentId = form.evaluatorAgentId.trim();
      }

      const res = await fetch('/api/erc8183-jobs/web-hire/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(
          data.detail || data.error || `Prepare failed (${res.status})`,
        );
      }

      setPrepareResult(data as PrepareResult);
      setSuccess('Prepare succeeded. Review the resolved details below.');
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Prepare failed.');
    } finally {
      setPreparing(false);
    }
  }

  /* ---- Sign Create Job ---- */
  async function handleSignCreateJob() {
    if (!prepareResult?.next?.createJob || !prepareResult.prepareId) return;

    try {
      setSigning(true);
      setError('');
      setSuccess('');
      setCreatedResult(null);
      setSignTxState('Switching to Arc Testnet…');

      // Switch wallet to Arc Testnet
      await switchChain(config, { chainId: 5042002 });

      // Use prepareResult.next.createJob as single source of truth
      const cj = prepareResult.next.createJob;
      setSignTxState('Waiting for wallet signature…');

      const createHash = await writeContractAsync({
        address: CONTRACTS.ERC8183_AGENTIC_COMMERCE as `0x${string}`,
        abi: ERC8183_AGENTIC_COMMERCE_ABI as unknown as Parameters<typeof writeContractAsync>[0]['abi'],
        functionName: 'createJob',
        args: [
          cj.provider as `0x${string}`,
          cj.evaluator as `0x${string}`,
          BigInt(cj.expiredAt),
          cj.description,
          cj.hook as `0x${string}`,
        ],
      });

      // Confirm with backend
      setSignTxState('Confirming JobCreated event…');
      const confirmRes = await fetch('/api/erc8183-jobs/web-hire/created', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prepareId: prepareResult.prepareId,
          createTxHash: createHash,
        }),
      });

      const confirmData = await confirmRes.json();
      if (!confirmRes.ok || !confirmData.ok) {
        throw new Error(
          confirmData.detail || confirmData.error || `Confirm failed (${confirmRes.status})`,
        );
      }

      setCreatedResult(confirmData as CreatedResult);
      setSuccess('ERC-8183 job created on-chain!');
      setSignTxState('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signing failed.');
      setSignTxState('');
    } finally {
      setSigning(false);
    }
  }

  /* ---- Render ---- */
  const selectedBuyer = linkedAgents.find((a) => a.agentId === form.buyerAgentId);

  const reviewRows = [
    ['Provider Agent', agentData?.name ?? '—'],
    ['Provider ID', agentData?.agentId ?? '—'],
    ['Buyer Agent', selectedBuyer?.metadataName || (form.buyerAgentId ? `Agent #${form.buyerAgentId}` : '—')],
    ['Category', agentData?.category ?? '—'],
    ['Deadline', form.timeline || '—'],
    ['Budget', form.budgetMax ? `${form.budgetMax} USDC` : '—'],
    ['Settlement', 'ERC-8183 Escrow'],
    ['Evaluator', form.evaluatorMode === 'client' ? 'Client (self)' : `Agent #${form.evaluatorAgentId}`],
    ['Client Wallet', session?.authenticated ? shortText(session.wallet || '') : 'Not signed in'],
  ] as const;

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
          href={agentId ? `/agent/${agentId}` : '/dashboard'}
          className="inline-flex items-center gap-2 text-sm text-[#F0B84A] transition hover:text-[#FFD084]"
        >
          ← Back to Agent Profile
        </Link>

        {/* Header */}
        <header className="mt-7">
          <h1 className="text-[42px] font-semibold tracking-[-0.04em] text-[#F4EFE5] md:text-[58px]">
            Direct Hire
          </h1>
          <p className="mt-3 max-w-3xl text-[15px] leading-7 text-[#EAE4D8]/66">
            Create an ERC-8183 escrow job directly with this agent.
            The provider is pre-selected — fill in the task details below.
          </p>
        </header>

        {/* Agent loading / error */}
        {agentLoading && (
          <div className="mt-8 flex min-h-[200px] items-center justify-center rounded-xl border border-white/10 bg-[#080D13]/70">
            <div className="font-mono text-[12px] text-[#EAE4D8]/55">
              Loading agent profile...
            </div>
          </div>
        )}

        {agentError && (
          <div className="mt-8 rounded-xl border border-red-500/25 bg-red-950/10 px-5 py-4 text-sm text-red-300">
            {agentError}
          </div>
        )}

        {/* Accordion sections */}
        {!agentLoading && agentData && (
          <div className="mt-6">
            <div className="space-y-3">
              {/* 1 — Provider Agent (read-only) */}
              <SectionCard
                number={1}
                title="Provider Agent"
                subtitle="This agent will receive the ERC-8183 job."
                status="Complete"
                open={openSections.provider}
                onToggle={() => toggleSection('provider')}
              >
                <div className="grid gap-5 lg:grid-cols-[200px_1fr]">
                  {/* Avatar */}
                  <div className="flex items-center justify-center">
                    {agentData.avatar ? (
                      <div className="h-[120px] w-[120px] overflow-hidden rounded-full border border-[#F3C536]/30 bg-black/30">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={agentData.avatar} alt="" className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <div className="flex h-[120px] w-[120px] items-center justify-center rounded-full border border-[#F3C536]/30 bg-[#0B0F14]">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#F3C536]/35 text-[22px] font-semibold text-[#F3C536]">
                          {agentData.name.slice(0, 1).toUpperCase()}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Details */}
                  <div className="grid gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-[20px] font-semibold text-[#F4EFE5]">
                        {agentData.name}
                      </h3>
                      <span className="rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-300">
                        {agentData.identityStatus}
                      </span>
                    </div>

                    <div className="grid gap-2 text-[13px] sm:grid-cols-2">
                      <div>
                        <span className="text-[#EAE4D8]/55">Agent ID: </span>
                        <span className="font-mono text-[#F5F0E5]">{agentData.agentId}</span>
                      </div>
                      <div>
                        <span className="text-[#EAE4D8]/55">Controller: </span>
                        <span className="font-mono text-[#F5F0E5]">{shortText(agentData.controller)}</span>
                      </div>
                      <div>
                        <span className="text-[#EAE4D8]/55">Role: </span>
                        <span className="text-[#F5F0E5]">{agentData.role}</span>
                      </div>
                      <div>
                        <span className="text-[#EAE4D8]/55">Category: </span>
                        <span className="text-[#F5F0E5]">{agentData.category}</span>
                      </div>
                    </div>

                    {agentData.capabilities.length > 0 && (
                      <div className="mt-1">
                        <span className="text-[12px] text-[#EAE4D8]/55">Capabilities: </span>
                        <span className="text-[12px] text-[#F5F0E5]">
                          {agentData.capabilities.slice(0, 6).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </SectionCard>

              {/* 2 — Client / Buyer Agent */}
              <SectionCard
                number={2}
                title="Client / Buyer Agent"
                subtitle="Your wallet session identity determines available buyer agents."
                status={buyerComplete ? 'Complete' : 'Pending'}
                open={openSections.client}
                onToggle={() => toggleSection('client')}
              >
                {sessionLoading ? (
                  <div className="font-mono text-[12px] text-[#EAE4D8]/55">
                    Checking wallet session…
                  </div>
                ) : !session?.authenticated ? (
                  /* ---- Not signed in: show connect + sign-in ---- */
                  <div className="grid gap-4">
                    <div className="rounded-lg border border-[#F0B84A]/20 bg-[#F0B84A]/8 px-4 py-3 text-sm text-[#EAE4D8]/72">
                      Sign in with your wallet to load your ERC-8004 buyer agent identities.
                    </div>
                    {!isConnected ? (
                      <div className="rounded-lg border border-white/[0.06] bg-black/25 px-4 py-3 text-sm text-[#EAE4D8]/55">
                        Connect your wallet using the navbar, then return here to sign in.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        <div className="text-[13px] text-[#EAE4D8]/55">
                          Wallet: <span className="font-mono text-[#F5F0E5]">{shortText(address || '')}</span>
                        </div>
                        <button
                          type="button"
                          onClick={handleSignIn}
                          disabled={signingIn}
                          className="h-12 w-fit rounded-lg border border-[#F0B84A]/55 bg-[#F0B84A]/20 px-8 text-sm font-semibold text-[#F0B84A] transition hover:border-[#F0B84A]/80 hover:bg-[#F0B84A]/30 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {signingIn ? 'Signing…' : 'Sign In with Wallet'}
                        </button>
                        {signInError && (
                          <div className="rounded-lg border border-red-400/25 bg-red-400/8 px-4 py-3 text-sm text-red-200">
                            {signInError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* ---- Signed in: show session status + agent picker ---- */
                  <div className="grid gap-5">
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-emerald-400/20 bg-emerald-400/8 px-4 py-3">
                      <div className="text-sm">
                        <span className="text-emerald-300">Signed in</span>
                        <span className="ml-2 font-mono text-[#EAE4D8]/72">
                          {shortText(session.wallet || '')}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="shrink-0 rounded-md border border-white/[0.06] bg-black/25 px-3 py-1.5 text-[11px] font-semibold text-[#EAE4D8]/55 transition hover:text-[#F4EFE5]"
                      >
                        Sign Out
                      </button>
                    </div>

                    {linkedAgents.length === 0 ? (
                      <div className="rounded-lg border border-red-400/20 bg-red-400/8 px-4 py-3 text-sm text-red-200">
                        No ERC-8004 agent identity found for this wallet. Register or sync an agent first.
                      </div>
                    ) : (
                      <div>
                        <FieldLabel required>Buyer Agent ID</FieldLabel>
                        <select
                          value={form.buyerAgentId}
                          onChange={(e) => update('buyerAgentId', e.target.value)}
                          className={inputCls}
                        >
                          <option value="">Select your buyer agent</option>
                          {linkedAgents.map((a) => (
                            <option key={a.agentId} value={a.agentId}>
                              {a.metadataName || `Agent #${a.agentId}`}
                              {a.agentId !== a.tokenId ? ` (token ${a.tokenId})` : ''}
                            </option>
                          ))}
                        </select>
                        <p className="mt-2 text-xs text-[#EAE4D8]/53">
                          This agent will be the ERC-8183 client/buyer. Loaded from your wallet session.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </SectionCard>

              {/* 3 — Task */}
              <SectionCard
                number={3}
                title="Task"
                subtitle="Describe the work you need done."
                status={taskComplete ? 'Complete' : 'Pending'}
                open={openSections.task}
                onToggle={() => toggleSection('task')}
              >
                <div className="grid gap-5">
                  <div>
                    <FieldLabel required>Description</FieldLabel>
                    <textarea
                      value={form.description}
                      onChange={(e) => update('description', e.target.value)}
                      rows={5}
                      maxLength={2000}
                      placeholder="Describe the task for this agent…"
                      className={textareaCls}
                    />
                    <p className="mt-2 text-xs text-[#EAE4D8]/53">
                      The agent will use this to understand the job requirements.
                    </p>
                  </div>
                </div>
              </SectionCard>

              {/* 4 — Scope */}
              <SectionCard
                number={4}
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
                      rows={4}
                      maxLength={2000}
                      placeholder="List the key deliverables you expect…"
                      className={textareaCls}
                    />
                  </div>

                  <div>
                    <FieldLabel required>Requirements</FieldLabel>
                    <textarea
                      value={form.requirements}
                      onChange={(e) => update('requirements', e.target.value)}
                      rows={4}
                      maxLength={1500}
                      placeholder="Required criteria for completion…"
                      className={textareaCls}
                    />
                  </div>

                  <div>
                    <FieldLabel required>Timeline</FieldLabel>
                    <select
                      value={form.timeline}
                      onChange={(e) => update('timeline', e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Select deadline</option>
                      <option value="24 hours">24 hours</option>
                      <option value="3 days">3 days</option>
                      <option value="7 days">7 days</option>
                      <option value="14 days">14 days</option>
                      <option value="30 days">30 days</option>
                    </select>
                  </div>

                  <div className="flex items-end">
                    <div className="rounded-lg border border-[#F0B84A]/20 bg-[#F0B84A]/8 px-4 py-3 text-sm text-[#EAE4D8]/72">
                      ⓘ A realistic timeline helps you receive better work.
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* 5 — Budget */}
              <SectionCard
                number={5}
                title="Budget"
                subtitle="Set the escrow budget for this job."
                status={budgetComplete ? 'Complete' : 'Pending'}
                open={openSections.budget}
                onToggle={() => toggleSection('budget')}
              >
                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <FieldLabel required>Escrow Budget</FieldLabel>
                    <div className="relative">
                      <input
                        value={form.budgetMax}
                        onChange={(e) => update('budgetMax', e.target.value)}
                        inputMode="decimal"
                        placeholder="e.g. 100"
                        className={`${inputCls} pr-20`}
                      />
                      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 font-mono text-xs text-[#EAE4D8]/62">
                        USDC
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[#EAE4D8]/62">
                      Budget amount for the escrow.
                    </p>
                  </div>

                  <div>
                    <FieldLabel>Evaluator Mode</FieldLabel>
                    <select
                      value={form.evaluatorMode}
                      onChange={(e) =>
                        update('evaluatorMode', e.target.value as 'client' | 'explicit')
                      }
                      className={inputCls}
                    >
                      <option value="client">Client as Evaluator</option>
                      <option value="explicit">Explicit Evaluator Agent</option>
                    </select>
                    <p className="mt-2 text-xs text-[#EAE4D8]/62">
                      {form.evaluatorMode === 'client'
                        ? 'Your connected wallet will evaluate the deliverable.'
                        : 'A separate agent will evaluate the deliverable.'}
                    </p>
                  </div>

                  {form.evaluatorMode === 'explicit' && (
                    <div className="lg:col-span-2">
                      <FieldLabel required>Evaluator Agent ID</FieldLabel>
                      <input
                        value={form.evaluatorAgentId}
                        onChange={(e) => update('evaluatorAgentId', e.target.value)}
                        placeholder="e.g. 12345"
                        className={inputCls}
                      />
                    </div>
                  )}
                </div>
              </SectionCard>

              {/* 6 — Review & Prepare */}
              <SectionCard
                number={6}
                title="Review & Prepare"
                subtitle="Confirm the ERC-8183 escrow job before preparing."
                status={
                  taskComplete && scopeComplete && budgetComplete
                    ? 'Complete'
                    : 'Pending'
                }
                open={openSections.review}
                onToggle={() => toggleSection('review')}
              >
                <div className="rounded-lg border border-white/[0.04] bg-black/25 p-4">
                  {reviewRows.map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-6 border-b border-white/[0.04] py-3 last:border-b-0"
                    >
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/38">
                        {label}
                      </span>
                      <span className="text-right text-sm font-semibold text-[#F4EFE5]">
                        {value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid gap-4">
                  {([
                    ['Description', form.description],
                    ['Deliverables', form.deliverables],
                    ['Requirements', form.requirements],
                  ] as const).map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-white/[0.04] bg-black/25 p-4"
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/38">
                        {label}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#F4EFE5]">
                        {value || 'Not set'}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-lg border border-[#F0B84A]/20 bg-[#F0B84A]/8 px-4 py-3 text-sm text-[#EAE4D8]/72">
                  This will call the prepare API using your wallet session cookie to resolve all participants from ERC-8004 identity records.
                </div>
              </SectionCard>

              {/* Feedback banners */}
              {preparing ? (
                <div className="rounded-lg border border-[#F0B84A]/25 bg-[#F0B84A]/10 px-5 py-3 text-sm text-[#F0B84A]">
                  Resolving identities and building job instruction…
                </div>
              ) : null}
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

              {/* Prepare result */}
              {prepareResult && (
                <div className="rounded-xl border border-[#B8CD7E]/25 bg-[#B8CD7E]/5 p-6">
                  <h3 className="text-lg font-semibold text-[#B8CD7E]">
                    Prepare Result
                  </h3>

                  <div className="mt-4 space-y-3">
                    {([
                      ['Settlement Mode', prepareResult.settlementMode],
                      ['Client Agent', prepareResult.participants.client.agentId],
                      ['Client Controller', shortText(prepareResult.participants.client.controller)],
                      ['Provider Agent', prepareResult.participants.provider.agentId],
                      ['Provider Controller', shortText(prepareResult.participants.provider.controller)],
                      ['Evaluator Agent', prepareResult.participants.evaluator.agentId],
                      ['Evaluator Controller', shortText(prepareResult.participants.evaluator.controller)],
                      ['Evaluator Mode', prepareResult.participants.evaluator.mode],
                      ['Budget', `${prepareResult.budget.formatted} USDC`],
                      ['Budget (Atomic)', prepareResult.budget.atomic],
                      ['Deadline (Unix)', prepareResult.expiry.expiredAtUnix],
                      ['Expired?', prepareResult.expiry.isExpired ? 'Yes' : 'No'],
                      ['Input Payload Hash', shortText(prepareResult.inputPayloadHash, 16, 8)],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-6">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/38">
                          {label}
                        </span>
                        <span className="max-w-[60%] truncate text-right text-sm font-mono text-[#F4EFE5]">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* next.createJob instruction preview */}
                  <div className="mt-6 rounded-lg border border-white/[0.06] bg-black/30 p-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#F3C536]">
                      next.createJob Instruction
                    </p>
                    <pre className="mt-3 overflow-auto text-[11px] leading-5 text-[#EAE4D8]/70">
                      {JSON.stringify(prepareResult.next.createJob, null, 2)}
                    </pre>
                  </div>

                  {/* Sign Create Job CTA — hidden until prepare succeeds */}
                  {!createdResult && (
                    <div className="mt-6">
                      <X402ActionGate lockedMessage="Pay 0.1 USDC via x402 on the homepage to unlock actions">
                        <button
                          type="button"
                          disabled={signing}
                          onClick={handleSignCreateJob}
                          className="h-12 w-full rounded-lg border border-[#F0B84A]/55 bg-[#F0B84A]/40 px-10 text-sm font-semibold text-black transition hover:border-[#F0B84A]/70 hover:bg-[#F0B84A]/55 disabled:cursor-not-allowed disabled:border-[#F0B84A]/25 disabled:bg-[#F0B84A]/15 disabled:text-black/40"
                        >
                          {signing ? 'Signing…' : 'Sign Create Job →'}
                        </button>
                      </X402ActionGate>
                    </div>
                  )}
                </div>
              )}

              {/* Signing status */}
              {signTxState ? (
                <div className="rounded-lg border border-[#F0B84A]/25 bg-[#F0B84A]/10 px-5 py-3 text-sm text-[#F0B84A]">
                  {signTxState}
                </div>
              ) : null}

              {/* Created result */}
              {createdResult && (
                <div className="rounded-xl border border-[#B8CD7E]/25 bg-[#B8CD7E]/5 p-6">
                  <h3 className="text-lg font-semibold text-[#B8CD7E]">
                    Job Created ✓
                  </h3>

                  <div className="mt-4 space-y-3">
                    {([
                      ['Local Job ID', createdResult.localJobId],
                      ['ERC-8183 Job ID', createdResult.erc8183JobId],
                      ['Create Tx Hash', shortText(createdResult.createTxHash, 16, 8)],
                      ['Provider', prepareResult?.participants.provider.agentId ?? '—'],
                      ['Evaluator', prepareResult?.participants.evaluator.agentId ?? '—'],
                      ['Buyer', prepareResult?.participants.client.agentId ?? '—'],
                      ['Budget', prepareResult ? `${prepareResult.budget.formatted} USDC` : '—'],
                      ['Status', createdResult.status],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-6">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#EAE4D8]/38">
                          {label}
                        </span>
                        <span className="max-w-[60%] truncate text-right text-sm font-mono text-[#F4EFE5]">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 rounded-lg border border-[#F0B84A]/20 bg-[#F0B84A]/8 px-4 py-3 text-sm text-[#EAE4D8]/72">
                    ⓘ Funding/approval is handled in the next step.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sticky bottom action bar */}
        {!agentLoading && agentData && (
          <div className="sticky bottom-0 z-20 mt-6 flex flex-col gap-4 rounded-t-xl border-t border-white/[0.04] bg-[#050505]/92 px-7 py-5 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-[#EAE4D8]/55 max-w-xl">
              {!session?.authenticated
                ? 'Sign in with your wallet to prepare this hire.'
                : !form.buyerAgentId
                  ? 'Select a buyer agent to continue.'
                  : 'All details will be resolved via your wallet session.'}
            </p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={saveDraft}
                className="h-12 rounded-lg border border-[#C5A67C]/35 bg-black/35 px-9 text-sm font-semibold text-[#F0B84A] transition hover:border-[#F0B84A]/70 hover:bg-[#F0B84A]/8"
              >
                Save Draft
              </button>
              <X402ActionGate lockedMessage="Pay 0.1 USDC via x402 on the homepage to unlock actions">
                <button
                  type="button"
                  disabled={!canPrepare || preparing}
                  onClick={handlePrepare}
                  title={
                    !session?.authenticated
                      ? 'Sign in with your wallet first'
                      : !form.buyerAgentId
                        ? 'Select a buyer agent'
                        : undefined
                  }
                  className="h-12 rounded-lg border border-[#F0B84A]/55 bg-[#F0B84A]/40 px-10 text-sm font-semibold text-black transition hover:border-[#F0B84A]/70 hover:bg-[#F0B84A]/55 disabled:cursor-not-allowed disabled:border-[#F0B84A]/25 disabled:bg-[#F0B84A]/15 disabled:text-black/40"
                >
                  {preparing ? 'Preparing…' : 'Prepare Job →'}
                </button>
              </X402ActionGate>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
