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
    metadataURI: '', // empty = auto-derive from name
  });
  const [nameStatus, setNameStatus] = useState<NameStatus>({ state: 'idle' });

  const derivedAgentId = useMemo(() => {
    try {
      return form.name.trim() ? nameToAgentId(form.name) : null;
    } catch { return null; }
  }, [form.name]);

  const effectiveMetadataURI = form.metadataURI.trim() || (form.name.trim()
    ? buildAgentMetadataURI(form.name, form.skill)
    : '');

  async function loadAgents() {
    setIsRefreshing(true);
    try { setAgents(await fetchIndexerJson<IndexedAgent[]>('/agents')); }
    finally { setIsRefreshing(false); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        setStatusTone('pending');
        const next = await fetchIndexerJson<IndexedAgent[]>('/agents');
        if (!cancelled) { setAgents(next); setStatusTone('synced'); }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : 'Failed to load agents.'); setStatusTone('error'); }
      } finally { if (!cancelled) setIsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Live name availability check — debounced 350ms.
  useEffect(() => {
    const norm = normalizeAgentName(form.name);
    if (!norm) { setNameStatus({ state: 'idle' }); return; }
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
      setStatusTone('pending');
      setTxState('Submitting registerAgent transaction…');
      const agentId = nameStatus.agentId;
      const metadataURI = effectiveMetadataURI;
      const hash = await writeContractAsync(
        buildRegisterAgentConfig(agentId, form.skill, metadataURI)
      );
      setTxState(`Waiting for ${hash.slice(0, 10)}…`);
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh…');
      const wantId = agentId.toString();
      const next = await waitForIndexer<IndexedAgent[]>(
        '/agents',
        (payload) => payload.some((a) => a.agentId === wantId)
      );
      setAgents(next);
      setStatusTone('synced');
      setTxState(`Agent "${form.name}" registered.`);
      setForm({ name: '', skill: 'solidity-auditor', metadataURI: '' });
      setNameStatus({ state: 'idle' });
    } catch (e) {
      setTxState(e instanceof Error ? e.message : 'Agent registration failed.');
      setStatusTone('error');
    } finally { setIsSubmitting(false); }
  }

  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="aureo-mono-label mb-3">PROTOCOL · AGENTS</div>
            <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[64px]">
              Agent <span className="italic text-[#C5A67C]">identity</span>
            </h1>
            <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[#9a9a9a]">
              Browse registered agents and push <span className="text-[#C5A67C]">registerAgent</span> transactions
              directly. Contract: <span className="text-[#C5A67C]">AgentRegistry</span> — soulbound identities with
              reputation and job history.
            </p>
          </div>
          <div className="flex gap-3 self-start md:self-auto">
            <button onClick={() => loadAgents()} className="btn-bordered">
              {isRefreshing ? 'REFRESHING…' : 'REFRESH'}
            </button>
            <Link href="/docs" className="btn-primary">SDK QUICKSTART</Link>
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
              statusTone === 'pending' ? 'PENDING · CONFIRMATION'
                : statusTone === 'synced' ? 'INDEXER · SYNCED'
                : statusTone === 'error' ? 'ACTION · ERROR'
                : 'READY'
            }
            body={txState || (isRefreshing ? 'Refreshing indexed agents.' : 'Ready for registerAgent flow.')}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="aureo-panel p-4 md:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="aureo-mono-label mb-2">LEDGER</div>
                <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Registered agents</h2>
              </div>
              <span className="font-mono text-[11px] text-[#C5A67C]">{agents.length} indexed</span>
            </div>
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
                  const subtitle = parseAgentName(a.metadataURI) ? shortAgentId(a.agentId) : null;
                  return (
                    <Link
                      key={a.agentId}
                      href={`/agent/${a.agentId}`}
                      className="aureo-list-card block px-4 py-3 md:px-5 md:py-4"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-mono text-[12.5px] text-[#EAE4D8]">{label}</span>
                        <span className="font-mono text-[11px] text-[#C5A67C]">Score {a.score}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-4 font-mono text-[10.5px] text-[#7A7A7A]">
                        <span>{subtitle ? `${subtitle} · ${shortenAddress(a.controller)}` : shortenAddress(a.controller)}</span>
                        <span>{a.jobs.length} jobs</span>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <div className="aureo-empty">
                  <span className="aureo-empty-glyph">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c1.5-4 4-6 7.5-6s6 2 7.5 6" strokeLinecap="round" /></svg>
                  </span>
                  <p className="font-mono text-[11.5px] text-[#EAE4D8]">No registered agents yet</p>
                  <p className="font-mono text-[10.5px] text-[#7A7A7A]">Register the first agent from the panel on the right to see it indexed here.</p>
                </div>
              )}
            </div>
          </section>

          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">ACTION · WRITE</div>
            <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Register agent</h2>
            <code className="mt-2 block font-mono text-[10.5px] text-[#7A7A7A]">AgentRegistry.registerAgent(keccak(name), skillHash, metadataURI)</code>

            <div className="mt-5 space-y-3">
              {/* Primary: human-readable name. agentId is derived. */}
              <div>
                <label className="mb-1 block font-mono text-[10.5px] tracking-[0.14em] text-[#7A7A7A]">AGENT NAME</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                  placeholder="e.g. pelong, solidity-auditor-3000, zk-friend"
                  className="input-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                {/* Live availability indicator */}
                <div className="mt-1.5 font-mono text-[10.5px]">
                  {nameStatus.state === 'idle' && (
                    <span className="text-[#7A7A7A]">Pick a unique handle. Lowercase, 2+ chars.</span>
                  )}
                  {nameStatus.state === 'checking' && (
                    <span className="text-[#C5A67C]">checking on chain…</span>
                  )}
                  {nameStatus.state === 'free' && (
                    <span className="text-[#B8CD7E]">✓ "{normalizeAgentName(form.name)}" is available</span>
                  )}
                  {nameStatus.state === 'taken' && (
                    <span className="text-[#f0c5c5]">✕ "{normalizeAgentName(form.name)}" already registered. Pick another.</span>
                  )}
                  {nameStatus.state === 'invalid' && (
                    <span className="text-[#f0c5c5]">✕ {nameStatus.reason}</span>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block font-mono text-[10.5px] tracking-[0.14em] text-[#7A7A7A]">SKILL LABEL</label>
                <input
                  value={form.skill}
                  onChange={(e) => setForm((c) => ({ ...c, skill: e.target.value }))}
                  placeholder="solidity-auditor"
                  className="input-mono"
                  autoComplete="off"
                />
              </div>

              {/* Derived metadataURI shown read-only by default; toggle to override. */}
              <div>
                <label className="mb-1 block font-mono text-[10.5px] tracking-[0.14em] text-[#7A7A7A]">
                  METADATA URI <span className="text-[#7A7A7A]">(auto)</span>
                </label>
                <input
                  value={form.metadataURI || effectiveMetadataURI}
                  onChange={(e) => setForm((c) => ({ ...c, metadataURI: e.target.value }))}
                  placeholder="arclayer://agent/<name>"
                  className="input-mono"
                  autoComplete="off"
                />
                <div className="mt-1.5 font-mono text-[10.5px] text-[#7A7A7A]">
                  Auto-built from your name. Override with an <code>ipfs://</code> URI for richer metadata.
                </div>
              </div>

              {/* Show the derived on-chain id so engineers can verify */}
              {derivedAgentId !== null && (
                <div className="mt-2 p-3 font-mono text-[10.5px] leading-5 text-[#7A7A7A]" style={{ border: '1px solid rgba(255, 255, 255, 0.06)', background: 'rgba(0,0,0,0.3)' }}>
                  <span className="text-[#C5A67C]">on-chain id:</span> <span className="text-[#EAE4D8]">{shortAgentId(derivedAgentId)}</span>
                  <span className="ml-2 text-[#7A7A7A]">(uint256 keccak256 of name)</span>
                </div>
              )}
            </div>

            <button
              onClick={handleRegisterAgent}
              disabled={!isConnected || isSubmitting || nameStatus.state !== 'free'}
              className="btn-primary mt-5"
              title={
                !isConnected ? 'Connect wallet first.' :
                nameStatus.state === 'taken' ? 'Name already registered.' :
                nameStatus.state === 'checking' ? 'Verifying availability…' :
                nameStatus.state === 'invalid' ? nameStatus.reason :
                'Sign registerAgent transaction.'
              }
            >
              {isSubmitting ? 'REGISTERING…' : 'REGISTER AGENT'}
            </button>

            <div className="mt-4 p-4 font-mono text-[11.5px] leading-5 text-[#9a9a9a]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.3)' }}>
              {isConnected ? '✓ Wallet connected — ready to send registerAgent.' : '⚠ Connect wallet to submit registerAgent.'}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
