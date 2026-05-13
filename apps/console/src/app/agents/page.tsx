'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { waitForTransactionReceipt } from '@wagmi/core';
import { useAccount, useWriteContract } from 'wagmi';
import { buildRegisterAgentConfig } from '@arclayer/sdk';
import { fetchIndexerJson, type IndexedAgent, waitForIndexer } from '@/lib/indexer';
import { StatusBanner } from '@/components/StatusBanner';
import { shortenAddress } from '@/lib/contracts';
import { config } from '@/lib/wagmi';

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
    agentId: '3',
    skill: 'solidity-auditor',
    metadataURI: 'ipfs://arclayer-agent-3',
  });

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

  async function handleRegisterAgent() {
    try {
      setIsSubmitting(true);
      setStatusTone('pending');
      setTxState('Submitting registerAgent transaction…');
      const hash = await writeContractAsync(
        buildRegisterAgentConfig(BigInt(form.agentId), form.skill, form.metadataURI)
      );
      setTxState(`Waiting for ${hash.slice(0, 10)}…`);
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh…');
      const next = await waitForIndexer<IndexedAgent[]>(
        '/agents',
        (payload) => payload.some((a) => a.agentId === form.agentId)
      );
      setAgents(next);
      setStatusTone('synced');
      setTxState('Agent registration confirmed.');
    } catch (e) {
      setTxState(e instanceof Error ? e.message : 'Agent registration failed.');
      setStatusTone('error');
    } finally { setIsSubmitting(false); }
  }

  return (
    <div className="relative px-6 py-16 md:px-10 md:py-20">
      <div className="mx-auto max-w-7xl">
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
          <section className="p-6" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.6)' }}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="aureo-mono-label mb-2">LEDGER</div>
                <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Registered agents</h2>
              </div>
              <span className="font-mono text-[11px] text-[#C5A67C]">{agents.length} indexed</span>
            </div>
            <div className="mt-5 space-y-3">
              {agents.length > 0 ? (
                agents.map((a) => (
                  <Link
                    key={a.agentId}
                    href={`/agent/${a.agentId}`}
                    className="ledger-row block border border-white/10 bg-black/20 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-[12.5px] text-[#EAE4D8]">Agent #{a.agentId}</span>
                      <span className="font-mono text-[11px] text-[#C5A67C]">Score {a.score}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 font-mono text-[10.5px] text-[#7A7A7A]">
                      <span>{shortenAddress(a.controller)}</span>
                      <span>{a.jobs.length} jobs</span>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="p-4 font-mono text-[11.5px] text-[#7A7A7A]" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.25)' }}>
                  {isLoading ? 'Loading agents…' : 'No indexed agents yet.'}
                </p>
              )}
            </div>
          </section>

          <section className="p-6" style={{ border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(10, 10, 10, 0.6)' }}>
            <div className="aureo-mono-label mb-2">ACTION · WRITE</div>
            <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Register agent</h2>
            <code className="mt-2 block font-mono text-[10.5px] text-[#7A7A7A]">AgentRegistry.registerAgent(agentId, skillHash, metadataURI)</code>
            <div className="mt-5 space-y-3">
              <input value={form.agentId} onChange={(e) => setForm((c) => ({ ...c, agentId: e.target.value }))} placeholder="agentId" className="input-mono" />
              <input value={form.skill} onChange={(e) => setForm((c) => ({ ...c, skill: e.target.value }))} placeholder="skill-label" className="input-mono" />
              <input value={form.metadataURI} onChange={(e) => setForm((c) => ({ ...c, metadataURI: e.target.value }))} placeholder="ipfs://…" className="input-mono" />
            </div>
            <button onClick={handleRegisterAgent} disabled={!isConnected || isSubmitting} className="btn-primary mt-5">
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
