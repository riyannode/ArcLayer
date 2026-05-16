'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { waitForTransactionReceipt, readContract } from '@wagmi/core';
import { useAccount, useWriteContract } from 'wagmi';
import { AGENT_REGISTRY_ABI, buildRegisterAgentConfig, CONTRACTS } from '@arclayer/sdk';
import { fetchIndexerJson, type IndexedAgent, waitForIndexer } from '@/lib/indexer';
import { StatusBanner } from '@/components/StatusBanner';
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

export default function AgentsPage() {
  const { isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [agents, setAgents] = useState<IndexedAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txState, setTxState] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'idle' | 'pending' | 'synced' | 'error'>('idle');
  const [form, setForm] = useState({
    name: '',
    skill: 'solidity-auditor',
    metadataURI: '',
  });
  const [nameStatus, setNameStatus] = useState<NameStatus>({ state: 'idle' });

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
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        setStatusTone('pending');
        const next = await fetchIndexerJson<IndexedAgent[]>('/agents');
        if (!cancelled) {
          setAgents(next);
          setStatusTone('synced');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load agents.');
          setStatusTone('error');
        }
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
    if (nameStatus.state != 'free') return;
    try {
      setIsSubmitting(true);
      setStatusTone('pending');
      setTxState('Submitting registerAgent transaction…');
      const agentId = nameStatus.agentId;
      const metadataURI = effectiveMetadataURI;
      const normalizedName = normalizeAgentName(form.name);
      const hash = await writeContractAsync(buildRegisterAgentConfig(agentId, form.skill, metadataURI));
      setTxState(`Waiting for ${hash.slice(0, 10)}…`);
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh…');
      const wantId = agentId.toString();
      try {
        const next = await waitForIndexer<IndexedAgent[]>('/agents', (payload) => payload.some((a) => a.agentId === wantId));
        setAgents(next);
        setStatusTone('synced');
        setTxState(`Agent "${normalizedName}" registered as ${shortAgentId(agentId)}.`);
      } catch {
        // Indexer hasn't caught up yet — tx is confirmed on-chain though
        setStatusTone('synced');
        setTxState(`Agent "${normalizedName}" registered on-chain as ${shortAgentId(agentId)}. Indexer syncing — refresh in a few seconds.`);
      }
      setForm({ name: '', skill: 'solidity-auditor', metadataURI: '' });
      setNameStatus({ state: 'idle' });
    } catch (e) {
      setTxState(e instanceof Error ? e.message : 'Agent registration failed.');
      setStatusTone('error');
    } finally {
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
        <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="aureo-mono-label mb-3">PROTOCOL · AGENTS</div>
            <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
              Register an <span className="italic text-[#C5A67C]">agent</span>
            </h1>
            <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.68)]">
              First register a readable agent name. Then copy the full agent ID or jump straight into Create Job without guessing the on-chain identifier.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 self-start md:self-auto">
            <button onClick={() => loadAgents()} className="btn-bordered">
              {isRefreshing ? 'REFRESHING…' : 'REFRESH'}
            </button>
            <Link href="/jobs" className="btn-primary">GO TO JOBS</Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4" style={{ border: '1px solid rgba(230, 130, 130, 0.35)', background: 'rgba(230, 130, 130, 0.06)' }}>
            <p className="font-mono text-[11.5px] text-[#f0c5c5]">{error}</p>
          </div>
        )}

        <div className="mb-6">
          <StatusBanner
            tone={statusTone}
            title={
              statusTone === 'pending'
                ? 'PENDING · CONFIRMATION'
                : statusTone === 'synced'
                  ? 'INDEXER · SYNCED'
                  : statusTone === 'error'
                    ? 'ACTION · ERROR'
                    : 'READY'
            }
            body={txState || (isRefreshing ? 'Refreshing registered agents.' : 'Ready for registerAgent flow.')}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.02fr_0.98fr]">
          <section className="aureo-panel p-4 md:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="aureo-mono-label mb-2">STEP 2 · REGISTERED AGENTS</div>
                <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Agent cards</h2>
              </div>
              <span className="font-mono text-[11px] text-[#C5A67C]">{agents.length} indexed</span>
            </div>
            <p className="mt-2 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.58)]">
              Compact list. Each row shows readable name, short ID, controller, score and jobs. Click Use to preselect for create job.
            </p>
            <div className="mt-5 space-y-3">
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
              ) : agents.length > 0 ? (
                agents.map((a) => {
                  const label = displayAgentLabel({ agentId: a.agentId, metadataURI: a.metadataURI });
                  const hasName = !!parseAgentName(a.metadataURI);
                  return (
                    <div key={a.agentId} className="aureo-list-card flex flex-col gap-2 px-3 py-2.5 md:flex-row md:items-center md:justify-between md:gap-4 md:px-4 md:py-2.5">
                      {/* Left: identity */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] text-[#EAE4D8]">{hasName ? label : `Agent ${label}`}</span>
                          {hasName && <span className="font-mono text-[10px] text-[rgba(234,228,216,0.5)]">{shortAgentId(a.agentId)}</span>}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-[rgba(234,228,216,0.5)]">
                          controller {shortenAddress(a.controller)}
                        </div>
                      </div>

                      {/* Center: badges */}
                      <div className="flex items-center gap-2">
                        <span className="chip-status success">Score {a.score}</span>
                        <span className="tag-pill">{a.jobs.length} jobs</span>
                      </div>

                      {/* Right: actions */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleCopyAgentId(a.agentId); }}
                          className="btn-bordered px-2.5 py-1.5 text-[9px]"
                          title={`Copy full ID: ${a.agentId}`}
                        >
                          Copy ID
                        </button>
                        <Link href={`/jobs?agentId=${encodeURIComponent(a.agentId)}`} className="btn-primary px-2.5 py-1.5 text-[9px]">
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
                  <p className="font-mono text-[11.5px] text-[#EAE4D8]">No registered agents yet</p>
                  <p className="font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">Complete Step 1 on the right. Your first registered agent will appear here automatically.</p>
                </div>
              )}
            </div>
          </section>

          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">STEP 1 · REGISTER BY NAME</div>
            <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Register agent</h2>
            <code className="mt-2 block font-mono text-[10.5px] text-[rgba(234,228,216,0.52)]">Agent Registry · registerAgent(keccak(name), skillHash, metadataURI)</code>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.68)]">AGENT NAME</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                  placeholder="e.g. pelong, solidity-auditor-3000, zk-friend"
                  className="input-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">Pick a unique readable handle. The on-chain agent ID is derived automatically from this name.</div>
                <div className="mt-1.5 font-mono text-[10.5px]">
                  {nameStatus.state === 'idle' && <span className="text-[rgba(234,228,216,0.58)]">Use lowercase. Minimum 2 characters.</span>}
                  {nameStatus.state === 'checking' && <span className="text-[#C5A67C]">Checking on chain…</span>}
                  {nameStatus.state === 'free' && <span className="text-[#B8CD7E]">✓ “{normalizeAgentName(form.name)}” is available</span>}
                  {nameStatus.state === 'taken' && <span className="text-[#f0c5c5]">✕ “{normalizeAgentName(form.name)}” is already registered</span>}
                  {nameStatus.state === 'invalid' && <span className="text-[#f0c5c5]">✕ {nameStatus.reason}</span>}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.68)]">SKILL LABEL</label>
                <input
                  value={form.skill}
                  onChange={(e) => setForm((c) => ({ ...c, skill: e.target.value }))}
                  placeholder="solidity-auditor"
                  className="input-mono"
                  autoComplete="off"
                />
                <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">Stored into the agent metadata URI so devs can identify the intended capability later.</div>
              </div>

              <div>
                <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.68)]">METADATA URI</label>
                <input
                  value={form.metadataURI || effectiveMetadataURI}
                  onChange={(e) => setForm((c) => ({ ...c, metadataURI: e.target.value }))}
                  placeholder="arclayer://agent/<name>"
                  className="input-mono"
                  autoComplete="off"
                />
                <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.58)]">Auto-generated from the name by default. Override only if you want custom metadata like an ipfs:// URI.</div>
              </div>

              {derivedAgentId !== null && (
                <div className="rounded-none border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.3)] px-4 py-3">
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.52)]">Derived On-Chain Agent ID</div>
                  <div className="mt-1 font-mono text-[11px] text-[#EAE4D8]">{shortAgentId(derivedAgentId)}</div>
                  <div className="mt-1 break-all font-mono text-[10px] leading-5 text-[rgba(234,228,216,0.58)]">{derivedAgentId.toString()}</div>
                </div>
              )}
            </div>

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
                        : 'Sign registerAgent transaction.'
              }
            >
              {isSubmitting ? 'REGISTERING…' : 'REGISTER AGENT'}
            </button>

            <div className="mt-4 rounded-none border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.3)] p-4 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.68)]">
              {isConnected
                ? '✓ Wallet connected. After registration, use the card actions on the left to copy the full ID or prefill the Jobs page.'
                : '⚠ Connect wallet to submit registerAgent.'}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
