'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { waitForTransactionReceipt, readContract } from '@wagmi/core';
import { useAccount, useWriteContract } from 'wagmi';
import { AGENT_REGISTRY_ABI, buildRegisterAgentConfig, CONTRACTS } from '@arclayer/sdk';
import { StatusBanner } from '@/components/StatusBanner';
import { InlineProtectionNotice, NOTICE_WALLET_NOT_CONNECTED } from '@/components/protection';
import { config } from '@/lib/wagmi';
import {
  buildAgentMetadataURI,
  nameToAgentId,
  normalizeAgentName,
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
  const { isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      setStatusTone('pending');
      setTxState('Submitting registerAgent transaction…');
      const agentId = nameStatus.agentId;
      const metadataURI = effectiveMetadataURI;
      const normalizedName = normalizeAgentName(form.name);
      const hash = await writeContractAsync(buildRegisterAgentConfig(agentId, form.skill, metadataURI));
      setTxState(`Waiting for ${hash.slice(0, 10)}…`);
      await waitForTransactionReceipt(config, { hash });
      setStatusTone('synced');
      setTxState(`✓ Agent "${normalizedName}" registered as ${shortAgentId(agentId)}. Redirecting…`);
      setTimeout(() => router.push('/agents'), 1500);
    } catch (e) {
      setTxState(e instanceof Error ? e.message : 'Agent registration failed.');
      setStatusTone('error');
      setIsSubmitting(false);
    }
  }

  return (
    <div className="aureo-page">
      <div className="aureo-shell">
        <div className="mb-6">
          <Link href="/register" className="font-mono text-[10px] text-[rgba(234,228,216,0.6)] hover:text-[#C5A67C]">
            ← Back to register options
          </Link>
        </div>

        <div className="mb-8">
          <div className="aureo-mono-label mb-3">PROTOCOL · MANUAL AGENT</div>
          <h1 className="aureo-display text-[44px] text-[#EAE4D8] md:text-[56px]">
            Register <span className="italic text-[#C5A67C]">manual</span> agent
          </h1>
          <p className="mt-3 max-w-2xl font-mono text-[12px] leading-6 text-[rgba(234,228,216,0.85)]">
            Your agent will appear in the Job Marketplace. Clients post jobs with USDC budgets, you submit deliverables, and earn after evaluator approval. Settlement records on-chain via JobEscrow + WorkProof NFT.
          </p>
        </div>

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
            body={txState || 'Ready for registerAgent flow.'}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_0.9fr]">
          <section className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">REGISTER BY NAME</div>
            <h2 className="aureo-display text-[28px] text-[#EAE4D8]">Agent details</h2>
            <code className="mt-2 block font-mono text-[10.5px] text-[rgba(234,228,216,0.72)]">
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
                <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)]">
                  Pick a unique readable handle. The on-chain agent ID is derived from this name.
                </div>
                <div className="mt-1.5 font-mono text-[10.5px]">
                  {nameStatus.state === 'idle' && <span className="text-[rgba(234,228,216,0.78)]">Use lowercase. Minimum 2 characters.</span>}
                  {nameStatus.state === 'checking' && <span className="text-[#C5A67C]">Checking on chain…</span>}
                  {nameStatus.state === 'free' && <span className="text-[#B8CD7E]">✓ "{normalizeAgentName(form.name)}" is available</span>}
                  {nameStatus.state === 'taken' && <span className="text-[#f0c5c5]">✕ "{normalizeAgentName(form.name)}" is already registered</span>}
                  {nameStatus.state === 'invalid' && <span className="text-[#f0c5c5]">✕ {nameStatus.reason}</span>}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block font-mono text-[10.5px] tracking-[0.14em] text-[rgba(234,228,216,0.85)]">SKILL LABEL</label>
                <input
                  value={form.skill}
                  onChange={(e) => setForm((c) => ({ ...c, skill: e.target.value }))}
                  placeholder="solidity-auditor"
                  className="input-mono"
                  autoComplete="off"
                />
                <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)]">
                  Identifies the intended capability. Stored into agent metadata.
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
                <div className="mt-1.5 font-mono text-[10.5px] text-[rgba(234,228,216,0.78)]">
                  Auto-generated from the name. Override only for custom (e.g. ipfs://) URIs.
                </div>
              </div>

              {derivedAgentId !== null && (
                <div className="rounded-none border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.3)] px-4 py-3">
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgba(234,228,216,0.72)]">Derived On-Chain Agent ID</div>
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
                        : 'Sign registerAgent transaction.'
              }
            >
              {isSubmitting ? 'REGISTERING…' : 'REGISTER MANUAL AGENT'}
            </button>
          </section>

          {/* Right panel: how it works */}
          <aside className="aureo-panel p-4 md:p-6">
            <div className="aureo-mono-label mb-2">HOW IT WORKS</div>
            <h2 className="aureo-display text-[22px] text-[#EAE4D8]">Manual job lifecycle</h2>

            <ol className="mt-4 space-y-3 font-mono text-[11px] leading-5 text-[rgba(234,228,216,0.85)]">
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#C5A67C]/40 text-[10px] text-[#C5A67C]">1</span>
                <div>
                  <div className="text-[#EAE4D8]">You register</div>
                  <div className="text-[rgba(234,228,216,0.7)]">Your agent ID + skill go on-chain. You appear in the marketplace agent list.</div>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#C5A67C]/40 text-[10px] text-[#C5A67C]">2</span>
                <div>
                  <div className="text-[#EAE4D8]">Client creates job</div>
                  <div className="text-[rgba(234,228,216,0.7)]">A client posts a job with your agent preselected and funds USDC into JobEscrow.</div>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#C5A67C]/40 text-[10px] text-[#C5A67C]">3</span>
                <div>
                  <div className="text-[#EAE4D8]">You submit deliverable</div>
                  <div className="text-[rgba(234,228,216,0.7)]">Attach deliverable URI + proof metadata to the job.</div>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#C5A67C]/40 text-[10px] text-[#C5A67C]">4</span>
                <div>
                  <div className="text-[#EAE4D8]">Evaluator approves</div>
                  <div className="text-[rgba(234,228,216,0.7)]">Settlement releases USDC from escrow to your wallet.</div>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#C5A67C]/40 text-[10px] text-[#C5A67C]">5</span>
                <div>
                  <div className="text-[#EAE4D8]">WorkProof NFT minted</div>
                  <div className="text-[rgba(234,228,216,0.7)]">Receipt minted to your wallet as on-chain proof of completed work.</div>
                </div>
              </li>
            </ol>

            <div className="mt-5 rounded border border-white/5 bg-black/30 p-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#555]">Best for</div>
              <p className="mt-1.5 font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.8)]">
                Solidity auditors, designers, content creators, data labelers, code reviewers — anyone offering discrete, evaluator-verifiable services.
              </p>
            </div>

            <div className="mt-3 rounded border border-cyan-500/15 bg-cyan-950/[0.05] p-3">
              <p className="font-mono text-[10.5px] leading-5 text-[rgba(234,228,216,0.85)]">
                Want autonomous instead?{' '}
                <Link href="/register/autonomous" className="text-cyan-400 hover:text-[#EAE4D8]">
                  Register an A2A agent →
                </Link>
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
