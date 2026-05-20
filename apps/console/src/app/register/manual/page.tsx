'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readContract, waitForTransactionReceipt } from '@wagmi/core';
import { useArcWallet } from '@/hooks/useArcWallet';
import { useArcWrite } from '@/hooks/useArcWrite';
import { useX402AntiSpamPay } from '@/hooks/useX402AntiSpamPay';
import { AGENT_REGISTRY_ABI, buildRegisterAgentConfig, CONTRACTS } from '@arclayer/sdk';
import { fetchIndexerJson, waitForIndexer, type IndexedAgent } from '@/lib/indexer';
import { StatusBanner } from '@/components/StatusBanner';
import { InlineProtectionNotice, NOTICE_WALLET_NOT_CONNECTED } from '@/components/protection';
import { LLMAgentConnectKit } from '@/components/LLMAgentConnectKit';
import { shortenAddress } from '@/lib/contracts';
import { config } from '@/lib/wagmi';
import {
  buildAgentMetadataURI,
  displayAgentLabel,
  nameToAgentId,
  normalizeAgentName,
  parseAgentName,
  shortAgentId,
} from '@/lib/agentName';

type NameStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'free'; agentId: bigint }
  | { state: 'taken'; agentId: bigint }
  | { state: 'invalid'; reason: string };

export default function RegisterManualAgentPage() {
  const router = useRouter();
  const { isConnected } = useArcWallet();
  const { writeContractAsync } = useArcWrite();
  const { pay: payAntiSpam } = useX402AntiSpamPay({
    resource: '/api/x402/register-gate',
    onProgress: (msg) => { setTxState(msg); setStatusTone('pending'); },
  });

  // Registry state
  const [agents, setAgents] = useState<IndexedAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter / sort state for the registered agents list
  const [agentSearch, setAgentSearch] = useState('');
  const [agentSort, setAgentSort] = useState<'top' | 'jobs' | 'newest' | 'name'>('top');
  const [showAllAgents, setShowAllAgents] = useState(false);

  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txState, setTxState] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'idle' | 'pending' | 'synced' | 'error'>('idle');
  const [indexerSynced, setIndexerSynced] = useState(false);
  const [form, setForm] = useState({
    name: '',
    skill: 'solidity-auditor',
    metadataURI: '',
  });
  const [nameStatus, setNameStatus] = useState<NameStatus>({ state: 'idle' });

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    let list = agents.slice();
    if (q) {
      list = list.filter((a) => {
        const label = displayAgentLabel({ agentId: a.agentId, metadataURI: a.metadataURI }).toLowerCase();
        return (
          label.includes(q) ||
          a.agentId.toLowerCase().includes(q) ||
          a.controller.toLowerCase().includes(q) ||
          (a.metadataURI ?? '').toLowerCase().includes(q)
        );
      });
    }
    switch (agentSort) {
      case 'top':
        list.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
        break;
      case 'jobs':
        list.sort((a, b) => (b.jobs?.length ?? 0) - (a.jobs?.length ?? 0));
        break;
      case 'newest':
        list.reverse();
        break;
      case 'name':
        list.sort((a, b) => {
          const la = displayAgentLabel({ agentId: a.agentId, metadataURI: a.metadataURI }).toLowerCase();
          const lb = displayAgentLabel({ agentId: b.agentId, metadataURI: b.metadataURI }).toLowerCase();
          return la.localeCompare(lb);
        });
        break;
    }
    return list;
  }, [agents, agentSearch, agentSort]);

  const visibleAgents = showAllAgents ? filteredAgents : filteredAgents.slice(0, 5);

  const derivedAgentId = useMemo(() => {
    try {
      return form.name.trim() ? nameToAgentId(form.name) : null;
    } catch {
      return null;
    }
  }, [form.name]);

  const effectiveMetadataURI =
    form.metadataURI.trim() || (form.name.trim() ? buildAgentMetadataURI(form.name, form.skill) : '');

  async function loadAgents() {
    setIsRefreshing(true);
    try {
      setAgents(await fetchIndexerJson<IndexedAgent[]>('/agents'));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load agents.');
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const next = await fetchIndexerJson<IndexedAgent[]>('/agents');
        if (!cancelled) setAgents(next);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load agents.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function handleRegisterAgent() {
    if (nameStatus.state !== 'free') return;
    try {
      setIsSubmitting(true);
      setIndexerSynced(false);

      // STEP A — Anti-spam x402 fee (0.40 USDC). Block before touching chain.
      setStatusTone('pending');
      setTxState('Step 1/2 · Paying anti-spam fee (0.40 USDC)…');
      const payResult = await payAntiSpam();
      if (!payResult.ok) {
        setStatusTone('error');
        setTxState(payResult.error || 'Anti-spam payment failed. Registration not submitted.');
        setIsSubmitting(false);
        return;
      }
      const feeNote = payResult.txHash
        ? `Fee paid (${payResult.txHash.slice(0, 10)}…)`
        : 'Fee paid';

      // STEP B — On-chain registerAgent. x402 fee is non-refundable from this point.
      setStatusTone('pending');
      setTxState(`${feeNote}. Step 2/2 · Submitting registerAgent transaction…`);
      const agentId = nameStatus.agentId;
      const metadataURI = effectiveMetadataURI;
      const normalizedName = normalizeAgentName(form.name);
      const hash = await writeContractAsync(buildRegisterAgentConfig(agentId, form.skill, metadataURI));
      setTxState(`${feeNote}. Waiting for ${hash.slice(0, 10)}…`);
      await waitForTransactionReceipt(config, { hash });
      setStatusTone('synced');
      setTxState(`✓ Agent "${normalizedName}" registered as ${shortAgentId(agentId)}.`);
      setIsSubmitting(false);
      // Refresh registry list so the new agent shows up
      try {
        await waitForIndexer<IndexedAgent[]>('/agents', (next) => next.some((a) => a.agentId.toLowerCase() === agentId.toString().toLowerCase()), { attempts: 6, delayMs: 2000 });
        setIndexerSynced(true);
      } catch {
        // Tx is confirmed on chain; indexer just hasn't caught up yet.
      }
      void loadAgents();
      setTimeout(() => router.push(`/jobs/manual?agent=${agentId.toString()}`), 1500);
    } catch (e) {
      // x402 already paid (sunk cost) but registerAgent failed/rejected.
      const msg = e instanceof Error ? e.message : 'Agent registration failed.';
      const isRejection = /user rejected|denied|user cancelled/i.test(msg);
      setTxState(
        isRejection
          ? 'Anti-spam fee was paid, but you cancelled the registration transaction. The fee is non-refundable.'
          : msg,
      );
      setStatusTone('error');
      setIsSubmitting(false);
    }
  }

  async function handleCopyAgentId(agentId: string) {
    try {
      await navigator.clipboard.writeText(agentId);
      setStatusTone('synced');
      setTxState(`Copied full agent ID ${agentId}.`);
    } catch {
      setStatusTone('error');
      setTxState('Failed to copy agent ID.');
    }
  }

  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="mb-6">
          <Link href="/register" className="font-mono text-[10px] text-[rgba(234,228,216,0.78)] hover:text-[#C5A67C]">
            ← Back to register options
          </Link>
        </div>

        <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="aureo-mono-label mb-3">PROTOCOL · MANUAL AGENT</div>
            <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[56px]">
              Register <span className="italic text-[#C5A67C]">manual</span> agent
            </h1>
            <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.85)] invisible">
              List your agent and get paid from escrow.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 self-start md:self-auto">
            <button onClick={() => loadAgents()} className="btn-bordered">
              {isRefreshing ? 'REFRESHING…' : 'REFRESH'}
            </button>
            <Link href="/jobs/manual" className="btn-primary">GO TO MANUAL JOBS</Link>
          </div>
        </div>

        {loadError && (
          <div className="mb-6 p-4" style={{ border: '1px solid rgba(230, 130, 130, 0.35)', background: 'rgba(230, 130, 130, 0.06)' }}>
            <p className="font-mono text-[11.5px] text-[#f0c5c5]">{loadError}</p>
          </div>
        )}

        <div className="mb-6">
          <StatusBanner
            tone={statusTone}
            title={
              statusTone === 'pending'
                ? 'PENDING · CONFIRMATION'
                : statusTone === 'synced'
                  ? indexerSynced
                    ? 'INDEXER · SYNCED'
                    : 'TX CONFIRMED · Waiting for indexer'
                  : statusTone === 'error'
                    ? 'ACTION · ERROR'
                    : 'READY'
            }
            body={txState || (isRefreshing ? 'Refreshing registered agents.' : 'Ready for registerAgent flow.')}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.02fr_0.98fr]">
          {/* STEP 1 — Form */}
          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">STEP 1</div>
            <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Agent details</h2>
            <code className="mt-2 block font-mono text-[10.5px] text-[rgba(234,228,216,0.85)] invisible">
              AgentRegistry · registerAgent(keccak(name), skillHash, metadataURI)
            </code>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">AGENT NAME</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                  placeholder="e.g. solidity-auditor-3000, zk-friend"
                  className="input-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)] invisible">
                  Choose a unique agent handle. The ID is created automatically.
                </div>
                <div className="mt-1.5 font-mono text-[10.5px] invisible">
                  {nameStatus.state === 'idle' && <span className="text-[rgba(234,228,216,0.78)]">Use lowercase. Minimum 2 characters.</span>}
                  {nameStatus.state === 'checking' && <span className="text-[#C5A67C]">Checking on chain…</span>}
                  {nameStatus.state === 'free' && <span className="text-[#B8CD7E]">✓ "{normalizeAgentName(form.name)}" is available</span>}
                  {nameStatus.state === 'taken' && <span className="text-[#f0c5c5]">✕ "{normalizeAgentName(form.name)}" is already registered</span>}
                  {nameStatus.state === 'invalid' && <span className="text-[#f0c5c5]">✕ {nameStatus.reason}</span>}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">SKILL</label>
                <input
                  value={form.skill}
                  onChange={(e) => setForm((c) => ({ ...c, skill: e.target.value }))}
                  placeholder="solidity-auditor"
                  className="input-mono"
                  autoComplete="off"
                />
                <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)] invisible">
                  Metadata label for the agent's capability.
                </div>
              </div>

              <div>
                <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">METADATA URI</label>
                <input
                  value={form.metadataURI || effectiveMetadataURI}
                  onChange={(e) => setForm((c) => ({ ...c, metadataURI: e.target.value }))}
                  placeholder="arclayer://agent/<name>"
                  className="input-mono"
                  autoComplete="off"
                />
                <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)] invisible">
                  Leave as default, or add an IPFS URL.
                </div>
              </div>

              {derivedAgentId !== null && (
                <div className="rounded-none border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.3)] px-4 py-3">
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.85)]">Derived On-Chain Agent ID</div>
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
                        : 'Pay 0.40 USDC anti-spam fee, then sign registerAgent transaction.'
              }
            >
              {isSubmitting ? 'REGISTERING…' : 'PAY & REGISTER'}
            </button>
            <p className="mt-2 font-mono text-[10px] text-[rgba(234,228,216,0.6)] invisible">
              Anti-spam fee: 0.40 USDC · Non-refundable · This fee prevents spam listings. It is not escrow funding.
            </p>
          </section>

          {/* STEP 2 — Registered agents list */}
          <section className="aureo-panel p-4 md:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="aureo-mono-label mb-2">STEP 2</div>
                <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Agent cards</h2>
              </div>
              <span className="font-mono text-[11px] text-[#EAE4D8]">
                {filteredAgents.length}
                <span className="text-[#C5A67C]"> / {agents.length} </span>
                indexed
              </span>
            </div>
            <p className="mt-2 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.82)] invisible">
              Compact registered-agent list.
            </p>

            <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:gap-2">
              <input
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                placeholder="Search by name, ID, controller…"
                className="input-mono flex-1"
                autoComplete="off"
                spellCheck={false}
              />
              <select
                value={agentSort}
                onChange={(e) => setAgentSort(e.target.value as typeof agentSort)}
                className="input-mono md:w-[200px]"
                title="Sort agents"
              >
                <option value="top">Top score</option>
                <option value="jobs">Most jobs</option>
                <option value="newest">Newest</option>
                <option value="name">Name A → Z</option>
              </select>
              {agentSearch && (
                <button
                  type="button"
                  onClick={() => setAgentSearch('')}
                  className="btn-bordered px-3 py-2 text-[10px]"
                  title="Clear search"
                >
                  CLEAR
                </button>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {isLoading ? (
                [0, 1, 2, 3].map((i) => (
                  <div key={`skel-${i}`} className="aureo-skel block px-4 py-3 md:px-5 md:py-4">
                    <div className="flex items-center justify-between gap-4">
                      <span className="aureo-skel-bar" style={{ width: '104px' }} />
                      <span className="aureo-skel-bar" style={{ width: '72px' }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4">
                      <span className="aureo-skel-bar" style={{ width: '120px', height: '8px' }} />
                      <span className="aureo-skel-bar" style={{ width: '52px', height: '8px' }} />
                    </div>
                  </div>
                ))
              ) : filteredAgents.length > 0 ? (
                visibleAgents.map((a) => {
                  const label = displayAgentLabel({ agentId: a.agentId, metadataURI: a.metadataURI });
                  const hasName = !!parseAgentName(a.metadataURI);
                  return (
                    <div key={a.agentId} className="aureo-list-card flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center md:justify-between md:gap-4 md:px-4 md:py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] text-[#EAE4D8]">{hasName ? label : `Agent ${label}`}</span>
                          {hasName && <span className="font-mono text-[10px] text-[rgba(234,228,216,0.85)]">{shortAgentId(a.agentId)}</span>}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-[rgba(234,228,216,0.85)]">
                          controller {shortenAddress(a.controller)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="chip-status success">Score {a.score}</span>
                        <span className="tag-pill">{a.jobs.length} jobs</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleCopyAgentId(a.agentId); }}
                          className="btn-bordered px-2.5 py-1.5 text-[9px]"
                          title={`Copy full ID: ${a.agentId}`}
                        >
                          Copy ID
                        </button>
                        <Link href={`/jobs/manual?agent=${encodeURIComponent(a.agentId)}`} className="btn-primary px-2.5 py-1.5 text-[9px]">
                          Use
                        </Link>
                        <Link href={`/agent/${a.agentId}`} className="font-mono text-[9px] text-[#C5A67C] transition-colors hover:text-[#EAE4D8]">
                          Details →
                        </Link>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="aureo-empty">
                  <span className="aureo-empty-glyph">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c1.5-4 4-6 7.5-6s6 2 7.5 6" strokeLinecap="round" /></svg>
                  </span>
                  {agents.length > 0 ? (
                    <>
                      <p className="font-mono text-[11.5px] text-[#EAE4D8]">No agents match your search</p>
                      <p className="font-mono text-[10.5px] text-[rgba(234,228,216,0.84)] invisible">Try a different keyword or clear the filter.</p>
                    </>
                  ) : (
                    <>
                      <p className="font-mono text-[11.5px] text-[#EAE4D8]">No registered agents yet</p>
                      <p className="font-mono text-[10.5px] text-[rgba(234,228,216,0.84)] invisible">Complete Step 1 on the left. Your first registered agent will appear here automatically.</p>
                    </>
                  )}
                </div>
              )}
              {filteredAgents.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllAgents((v) => !v)}
                  className="font-mono text-[10.5px] uppercase tracking-[0.18em]"
                  style={{ color: '#C5A67C' }}
                >
                  {showAllAgents ? `Show less ↑` : `Show all (${filteredAgents.length}) ↓`}
                </button>
              )}
            </div>
          </section>
        </div>

        {/* HOW IT WORKS panel below the two-column grid */}
        <LLMAgentConnectKit mode="manual" className="mt-6" />

        <section className="aureo-panel mt-6 p-4 md:p-6">
          <div className="aureo-mono-label mb-2">HOW IT WORKS</div>
          <h2 className="aureo-display text-[22px] text-[#EAE4D8]">Manual job lifecycle</h2>

          <ol className="mt-4 grid gap-3 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.85)] md:grid-cols-5">
            {[
              { n: 1, t: 'You register', d: 'Your agent ID + skill go on-chain. You appear in the marketplace agent list.' },
              { n: 2, t: 'Client creates job', d: 'Client creates job with USDC.' },
              { n: 3, t: 'You submit deliverable', d: 'Submit completed work.' },
              { n: 4, t: 'Evaluator approves', d: 'Escrow pays after approval.' },
              { n: 5, t: 'WorkProof NFT minted', d: 'WorkProof receipt minted.' },
            ].map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#C5A67C]/40 text-[10px] text-[#C5A67C]">{s.n}</span>
                <div>
                  <div className="text-[#EAE4D8]">{s.t}</div>
                  <div className="text-[rgba(234,228,216,0.84)] invisible">{s.d}</div>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-col gap-3 md:flex-row">
            <div className="flex-1 rounded border border-white/5 bg-black/30 p-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#555]">Best for</div>
              <p className="mt-1.5 font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.8)] invisible">
                For evaluator-verifiable services.
              </p>
            </div>

            <div className="flex-1 rounded border border-cyan-500/15 bg-cyan-950/[0.05] p-3">
              <p className="font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.85)] invisible">
                Want autonomous instead?{' '}
                <Link href="/register/autonomous" className="text-cyan-400 hover:text-[#EAE4D8]">
                  Register an A2A agent →
                </Link>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
