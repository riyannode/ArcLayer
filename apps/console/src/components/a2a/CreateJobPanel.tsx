'use client';

import { useState, useCallback } from 'react';
import { useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from '@wagmi/core';
import { parseUnits, keccak256, toBytes, type Hex } from 'viem';
import { config } from '@/lib/wagmi';
import { useArcWallet } from '@/hooks/useArcWallet';
import { ERC8183_ABI } from '@/lib/contracts/erc8183';
import { USDC_ADDRESS } from '@/lib/x402/constants';
import type { NetworkAgent } from '@/types/agent-network';

const AGENTIC_COMMERCE = '0x0747EEf0706327138c69792bF28Cd525089e4583' as const;
const USDC_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

type Step = 'idle' | 'creating' | 'budget' | 'approving' | 'funding' | 'done' | 'error';

export function CreateJobPanel({
  agent,
  onClose,
  onCreated,
}: {
  agent: NetworkAgent;
  onClose: () => void;
  onCreated?: (jobId: string) => void;
}) {
  const { address, isConnected } = useArcWallet();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [createdJobId, setCreatedJobId] = useState<bigint | null>(null);
  const [txHashes, setTxHashes] = useState<string[]>([]);

  // Form fields
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('1.00');
  const [duration, setDuration] = useState('24');

  const providerAddress = agent.wallet as `0x${string}` | undefined;

  const handleCreate = useCallback(async () => {
    if (!isConnected || !address) {
      setError('Connect wallet first.');
      setStep('error');
      return;
    }
    if (!providerAddress || !providerAddress.startsWith('0x')) {
      setError('Agent has no wallet address. Cannot create job.');
      setStep('error');
      return;
    }

    setError(null);
    const hashes: string[] = [];

    try {
      // Step 1: createJob on-chain
      setStep('creating');
      const expiredAt = BigInt(Math.floor(Date.now() / 1000) + Number(duration) * 3600);
      const descHash = description || `Job for ${agent.name}`;

      const createTx = await writeContractAsync({
        address: AGENTIC_COMMERCE,
        abi: ERC8183_ABI as any,
        functionName: 'createJob',
        args: [
          providerAddress,
          address, // evaluator = connected wallet (self-evaluation, Arc spec requires non-zero)
          expiredAt,
          descHash,
          '0x0000000000000000000000000000000000000000', // hook = none
        ],
      });
      hashes.push(createTx);

      const createReceipt = await waitForTransactionReceipt(config, { hash: createTx });

      // Parse JobCreated event to get jobId
      let jobId: bigint | null = null;
      for (const log of createReceipt.logs) {
        try {
          if (log.address.toLowerCase() === AGENTIC_COMMERCE.toLowerCase()) {
            // JobCreated(uint256 jobId, address client, address provider, address evaluator)
            if (log.topics[0] === keccak256(toBytes('JobCreated(uint256,address,address,address)'))) {
              jobId = BigInt(log.topics[1] as string);
            }
          }
        } catch { /* skip non-matching logs */ }
      }

      if (!jobId && jobId !== 0n) {
        // Fallback: try decoding from data
        setError('Job created but could not parse jobId from receipt. Check tx on explorer.');
        setStep('error');
        setTxHashes(hashes);
        return;
      }

      setCreatedJobId(jobId);
      setTxHashes([...hashes]);

      // Step 2: setBudget
      setStep('budget');
      const budgetAtomic = parseUnits(budget, 6); // USDC 6 decimals
      const setBudgetTx = await writeContractAsync({
        address: AGENTIC_COMMERCE,
        abi: ERC8183_ABI as any,
        functionName: 'setBudget',
        args: [jobId, budgetAtomic, '0x' as Hex],
      });
      hashes.push(setBudgetTx);
      await waitForTransactionReceipt(config, { hash: setBudgetTx });
      setTxHashes([...hashes]);

      // Step 3: approve USDC
      setStep('approving');
      const approveTx = await writeContractAsync({
        address: USDC_ADDRESS as `0x${string}`,
        abi: USDC_ABI as any,
        functionName: 'approve',
        args: [AGENTIC_COMMERCE, budgetAtomic],
      });
      hashes.push(approveTx);
      await waitForTransactionReceipt(config, { hash: approveTx });
      setTxHashes([...hashes]);

      // Step 4: fund
      setStep('funding');
      const fundTx = await writeContractAsync({
        address: AGENTIC_COMMERCE,
        abi: ERC8183_ABI as any,
        functionName: 'fund',
        args: [jobId, '0x' as Hex],
      });
      hashes.push(fundTx);
      await waitForTransactionReceipt(config, { hash: fundTx });
      setTxHashes([...hashes]);

      setStep('done');
      onCreated?.(jobId.toString());
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || 'Transaction failed';
      setError(msg);
      setStep('error');
      setTxHashes([...hashes]);
    }
  }, [isConnected, address, providerAddress, description, budget, duration, agent.name, writeContractAsync, onCreated]);

  const stepLabel: Record<Step, string> = {
    idle: 'Ready',
    creating: '1/4 · Creating job on-chain…',
    budget: '2/4 · Setting budget…',
    approving: '3/4 · Approving USDC…',
    funding: '4/4 · Funding escrow…',
    done: '✓ Job created & funded',
    error: 'Error',
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded border border-white/10 bg-[#0A0A0A] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C5A67C]">Create Escrow Job</p>
            <h3 className="mt-1 text-xl font-semibold text-[#EAE4D8]">→ {agent.name}</h3>
            <p className="font-mono text-[10px] text-[#777] mt-1">
              Provider: {providerAddress ? `${providerAddress.slice(0, 8)}…${providerAddress.slice(-6)}` : 'No wallet'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/10 px-2 py-1 font-mono text-[10px] text-[#777] hover:text-[#EAE4D8] hover:border-[#C5A67C]/40"
          >
            ESC
          </button>
        </div>

        {step === 'idle' || step === 'error' ? (
          <>
            {/* Form */}
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-[rgba(234,228,216,0.7)]">
                  Job Description
                </label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={`Task for ${agent.name}`}
                  className="w-full rounded border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-[#EAE4D8] placeholder:text-[#444] focus:border-[#C5A67C]/40 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-[rgba(234,228,216,0.7)]">
                    Budget (USDC)
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    className="w-full rounded border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-[#EAE4D8] focus:border-[#C5A67C]/40 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-[rgba(234,228,216,0.7)]">
                    Deadline (hours)
                  </label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className="w-full rounded border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[11px] text-[#EAE4D8] focus:border-[#C5A67C]/40 focus:outline-none"
                  >
                    <option value="1">1 hour</option>
                    <option value="6">6 hours</option>
                    <option value="24">24 hours</option>
                    <option value="72">3 days</option>
                    <option value="168">7 days</option>
                  </select>
                </div>
              </div>

              {error && (
                <div className="rounded border border-red-500/20 bg-red-950/10 px-3 py-2 font-mono text-[10px] text-red-300">
                  ⚠ {error}
                </div>
              )}

              {txHashes.length > 0 && (
                <div className="rounded border border-white/5 bg-white/[0.015] px-3 py-2 font-mono text-[9px] text-[#777] space-y-1">
                  {txHashes.map((h, i) => (
                    <div key={i}>
                      tx{i + 1}: <a href={`https://testnet.arcscan.app/tx/${h}`} target="_blank" rel="noopener noreferrer" className="text-[#C5A67C] hover:underline">{h.slice(0, 14)}…</a>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={handleCreate}
                disabled={!providerAddress || !providerAddress.startsWith('0x')}
                className="w-full rounded border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#C5A67C] transition hover:bg-[#C5A67C]/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {!providerAddress || !providerAddress.startsWith('0x')
                  ? 'Agent has no wallet'
                  : `Create & Fund Job · ${budget} USDC`}
              </button>
            </div>
          </>
        ) : step === 'done' ? (
          /* Success */
          <div className="space-y-4">
            <div className="rounded border border-emerald-500/20 bg-emerald-950/10 px-4 py-3">
              <p className="font-mono text-[11px] text-emerald-300">
                ✓ Job #{createdJobId?.toString()} created and funded with {budget} USDC
              </p>
              <p className="mt-1 font-mono text-[10px] text-emerald-400/60">
                Provider: {agent.name} · Deadline: {duration}h
              </p>
            </div>

            {txHashes.length > 0 && (
              <div className="rounded border border-white/5 bg-white/[0.015] px-3 py-2 font-mono text-[9px] text-[#777] space-y-1">
                {txHashes.map((h, i) => (
                  <div key={i}>
                    tx{i + 1}: <a href={`https://testnet.arcscan.app/tx/${h}`} target="_blank" rel="noopener noreferrer" className="text-[#C5A67C] hover:underline">{h.slice(0, 14)}…</a>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <a
                href={`/job/${createdJobId}`}
                className="flex-1 rounded border border-[#C5A67C]/40 bg-[#C5A67C]/10 px-4 py-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[#C5A67C] hover:bg-[#C5A67C]/20"
              >
                View Job Detail →
              </a>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#777] hover:text-[#EAE4D8]"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          /* Progress */
          <div className="space-y-4 py-6">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#C5A67C] opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-[#C5A67C]" />
              </span>
              <p className="font-mono text-[12px] text-[#EAE4D8]">{stepLabel[step]}</p>
            </div>
            <div className="h-1 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-[#C5A67C] transition-all duration-500"
                style={{
                  width: step === 'creating' ? '25%' : step === 'budget' ? '50%' : step === 'approving' ? '75%' : '90%',
                }}
              />
            </div>
            {txHashes.length > 0 && (
              <div className="font-mono text-[9px] text-[#555]">
                {txHashes.length} tx{txHashes.length > 1 ? 's' : ''} submitted
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
