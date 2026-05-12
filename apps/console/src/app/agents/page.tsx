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
    try {
      const nextAgents = await fetchIndexerJson<IndexedAgent[]>('/agents');
      setAgents(nextAgents);
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        setStatusTone('pending');
        const nextAgents = await fetchIndexerJson<IndexedAgent[]>('/agents');
        if (!cancelled) {
          setAgents(nextAgents);
          setStatusTone('synced');
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Failed to load agents.');
          setStatusTone('error');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRegisterAgent() {
    try {
      setIsSubmitting(true);
      setStatusTone('pending');
      setTxState('Submitting registerAgent transaction...');
      const hash = await writeContractAsync(
        buildRegisterAgentConfig(BigInt(form.agentId), form.skill, form.metadataURI)
      );
      setTxState(`Waiting for ${hash.slice(0, 10)}...`);
      await waitForTransactionReceipt(config, { hash });
      setTxState('Receipt confirmed. Waiting for indexer refresh...');
      const nextAgents = await waitForIndexer<IndexedAgent[]>(
        '/agents',
        (payload) => payload.some((agent) => agent.agentId === form.agentId)
      );
      setAgents(nextAgents);
      setStatusTone('synced');
      setTxState('Agent registration confirmed.');
    } catch (nextError) {
      setTxState(nextError instanceof Error ? nextError.message : 'Agent registration failed.');
      setStatusTone('error');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/35">Agent directory</p>
            <h1 className="mt-3 font-[var(--font-display)] text-[34px] font-semibold tracking-[-0.03em] md:text-[52px]">
              Indexed agent registry
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/50">
              Browse registered agents and push new `registerAgent` transactions directly from the console.
            </p>
          </div>
          <div className="flex gap-3 self-start md:self-auto">
            <button
              onClick={() => loadAgents()}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white/80"
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <Link href="/docs" className="btn-primary">
              SDK Quickstart
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
            {error}
          </div>
        )}

        <div className="mb-6">
          <StatusBanner
            tone={statusTone}
            title={
              statusTone === 'pending'
                ? 'Pending Confirmation'
                : statusTone === 'synced'
                  ? 'Indexer Synced'
                  : statusTone === 'error'
                    ? 'Action Error'
                    : 'Ready'
            }
            body={
              txState ||
              (isRefreshing
                ? 'Refreshing indexed agent list from the local indexer.'
                : 'Agent registry is loaded and ready for manual refresh or a new registerAgent flow.')
            }
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="glass-card p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-light">Registered agents</h2>
              <span className="font-mono text-xs text-cyan-200">{agents.length} indexed</span>
            </div>
            <div className="mt-5 space-y-3">
              {agents.length > 0 ? (
                agents.map((agent) => (
                  <Link
                    key={agent.agentId}
                    href={`/agent/${agent.agentId}`}
                    className="block rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-cyan-300/30"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm font-semibold text-white">Agent #{agent.agentId}</span>
                      <span className="font-mono text-xs text-cyan-200">Score {agent.score}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 text-xs text-white/45">
                      <span>{shortenAddress(agent.controller)}</span>
                      <span>{agent.jobs.length} jobs</span>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-white/45">
                  {isLoading ? 'Loading agents...' : 'No indexed agents yet.'}
                </p>
              )}
            </div>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-lg font-light">Register agent</h2>
            <p className="mt-2 text-sm leading-6 text-white/45">
              This triggers `AgentRegistry.registerAgent(agentId, skillHash, metadataURI)` using the connected wallet.
            </p>
            <div className="mt-5 space-y-3">
              <input
                value={form.agentId}
                onChange={(event) => setForm((current) => ({ ...current, agentId: event.target.value }))}
                placeholder="Agent ID"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={form.skill}
                onChange={(event) => setForm((current) => ({ ...current, skill: event.target.value }))}
                placeholder="Skill label"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                value={form.metadataURI}
                onChange={(event) => setForm((current) => ({ ...current, metadataURI: event.target.value }))}
                placeholder="ipfs://..."
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none"
              />
            </div>
            <button
              onClick={handleRegisterAgent}
              disabled={!isConnected || isSubmitting}
              className="mt-5 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? 'Registering...' : 'Register Agent'}
            </button>
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/45">
              {isConnected ? 'Wallet connected. Ready to send registerAgent.' : 'Connect wallet to submit agent registration.'}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
