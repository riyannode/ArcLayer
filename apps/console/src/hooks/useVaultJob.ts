'use client';

/**
 * useVaultJob — orchestrates the on-chain vault deposit flow.
 *
 * Flow (client-side):
 *   1. (read) Check USDC allowance for ArcVault
 *   2. (write) approve USDC if needed
 *   3. (write) ArcVault.deposit(amount)  — funds Vault 1
 *   4. (write) ArcVault.createJob(...)   — allocates V1 → job
 *   5. (read)  Parse JobCreated event → on-chain jobId
 *   6. (server) POST /api/vault/jobs with txHashes + on-chain jobId for indexing
 *
 * The hook is dual-mode aware (passkey + EOA) via useArcWrite.
 */

import { useCallback, useState } from 'react';
import { type Abi, type Address, parseUnits, keccak256, toHex, decodeEventLog } from 'viem';
import { readContract, getPublicClient, waitForTransactionReceipt } from '@wagmi/core';
import { useArcWrite } from './useArcWrite';
import { useArcWallet } from './useArcWallet';
import { useAuthFetch } from './useAuthFetch';
import { config } from '@/lib/wagmi';
import { ARC_VAULT_ADDRESS, USDC_DECIMALS } from '@/lib/vault/constants';
import { USDC_ADDRESS } from '@/lib/x402/constants';
import arcVaultAbiJson from '@/lib/vault/abi/arc-vault.json';
import erc20AbiJson from '@/lib/vault/abi/erc20.json';

const arcVaultAbi = arcVaultAbiJson as Abi;
const erc20Abi = erc20AbiJson as Abi;

export type VaultMilestone = {
  amount: string; // USDC string e.g. "100.00"
  description: string;
  deadline?: number; // unix seconds; defaults to job deadline
};

export type CreateVaultJobInput = {
  jobberAddress: Address;
  totalAmount: string; // USDC string (full)
  milestones: VaultMilestone[];
  specJson: unknown; // hashed for on-chain commitment
  jobDeadlineSeconds?: number; // defaults to 30d
};

export type VaultJobStep = 'idle' | 'allowance' | 'approving' | 'depositing' | 'creating' | 'indexing' | 'done' | 'error';

export type VaultJobState = {
  step: VaultJobStep;
  message: string;
  txApprove?: `0x${string}`;
  txDeposit?: `0x${string}`;
  txCreate?: `0x${string}`;
  onChainJobId?: bigint;
  dbJobId?: string;
  errorReason?: string;
};

export function useVaultJob() {
  const { address, isConnected } = useArcWallet();
  const { writeContractAsync, isPending } = useArcWrite();
  const { authFetch } = useAuthFetch();
  const [state, setState] = useState<VaultJobState>({ step: 'idle', message: 'Ready.' });

  const createVaultJob = useCallback(async (input: CreateVaultJobInput) => {
    if (!isConnected || !address) {
      setState({ step: 'error', message: 'Wallet not connected.', errorReason: 'no_wallet' });
      throw new Error('Wallet not connected.');
    }
    if (ARC_VAULT_ADDRESS === '0x0000000000000000000000000000000000000000') {
      setState({
        step: 'error',
        message: 'ArcVault contract not deployed yet. Update ARC_VAULT_ADDRESS after deploy.',
        errorReason: 'vault_not_deployed',
      });
      throw new Error('ArcVault contract not deployed.');
    }

    const owner = address as Address;

    try {
      // ── 1. Compute amounts ────────────────────────────────────────
      const totalUnits = parseUnits(input.totalAmount, USDC_DECIMALS);
      const milestoneAmounts = input.milestones.map((m) => parseUnits(m.amount, USDC_DECIMALS));

      const sumCheck = milestoneAmounts.reduce((s, x) => s + x, BigInt(0));
      if (sumCheck !== totalUnits) {
        throw new Error(`Milestone sum (${sumCheck}) != total (${totalUnits})`);
      }

      const now = Math.floor(Date.now() / 1000);
      const jobDeadline = BigInt(input.jobDeadlineSeconds ?? now + 30 * 24 * 3600);
      const milestoneDeadlines = input.milestones.map((m) => BigInt(m.deadline ?? Number(jobDeadline)));

      // specHash = keccak256 of canonical spec JSON
      const specHash = keccak256(toHex(JSON.stringify(input.specJson)));

      // ── 2. Check allowance ────────────────────────────────────────
      setState({ step: 'allowance', message: 'Checking USDC allowance…' });
      const currentAllowance = await readContract(config, {
        address: USDC_ADDRESS as Address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [owner, ARC_VAULT_ADDRESS as Address],
      } as any) as bigint;

      let txApprove: `0x${string}` | undefined;
      if (currentAllowance < totalUnits) {
        setState({ step: 'approving', message: `Approving ${input.totalAmount} USDC for Vault…` });
        txApprove = await writeContractAsync({
          address: USDC_ADDRESS as Address,
          abi: erc20Abi,
          functionName: 'approve',
          args: [ARC_VAULT_ADDRESS as Address, totalUnits],
        });
      }

      // ── 3. Deposit to V1 ──────────────────────────────────────────
      setState((s) => ({ ...s, step: 'depositing', message: `Depositing ${input.totalAmount} USDC to Vault 1…`, txApprove }));
      const txDeposit = await writeContractAsync({
        address: ARC_VAULT_ADDRESS as Address,
        abi: arcVaultAbi,
        functionName: 'deposit',
        args: [totalUnits],
      });

      // ── 4. Create job (allocate V1 → job) ─────────────────────────
      setState((s) => ({ ...s, step: 'creating', message: 'Creating job on-chain…', txDeposit }));
      const txCreate = await writeContractAsync({
        address: ARC_VAULT_ADDRESS as Address,
        abi: arcVaultAbi,
        functionName: 'createJob',
        args: [totalUnits, specHash, milestoneAmounts, milestoneDeadlines, jobDeadline],
      });

      // ── 5. Parse JobCreated event for on-chain jobId ──────────────
      let onChainJobId: bigint | undefined;
      try {
        const receipt = await waitForTransactionReceipt(config, { hash: txCreate });
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== (ARC_VAULT_ADDRESS as string).toLowerCase()) continue;
          try {
            const decoded = decodeEventLog({
              abi: arcVaultAbi,
              data: log.data,
              topics: log.topics,
            }) as unknown as { eventName: string; args: Record<string, unknown> };
            if (decoded.eventName === 'JobCreated') {
              onChainJobId = (decoded.args as { jobId: bigint }).jobId;
              break;
            }
          } catch {
            // skip non-matching logs
          }
        }
      } catch (e) {
        // non-fatal — receipt parsing failure shouldn't block indexing
        console.warn('[useVaultJob] receipt parse failed', e);
      }

      // ── 6. Index in Supabase ──────────────────────────────────────
      setState((s) => ({ ...s, step: 'indexing', message: 'Indexing job…', txCreate, onChainJobId }));
      const res = await authFetch('/api/vault/jobs', {
        method: 'POST',
        body: JSON.stringify({
          clientAddress: owner,
          jobberAddress: input.jobberAddress,
          totalAmount: input.totalAmount,
          durationTier: input.milestones.length > 1 ? 'milestone' : 'single_payout',
          specJson: input.specJson,
          milestones: input.milestones.map((m, i) => ({
            index: i,
            description: m.description,
            amount: m.amount,
          })),
          onChainJobId: onChainJobId?.toString(),
          txHashes: { approve: txApprove, deposit: txDeposit, create: txCreate },
          specHash,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Indexing failed: HTTP ${res.status}`);
      }

      const json = await res.json();
      setState({
        step: 'done',
        message: `Vault job created ✓ on-chain id #${onChainJobId?.toString() ?? '—'}`,
        txApprove,
        txDeposit,
        txCreate,
        onChainJobId,
        dbJobId: json.jobId,
      });

      return { txApprove, txDeposit, txCreate, onChainJobId, dbJobId: json.jobId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState({ step: 'error', message: msg, errorReason: msg });
      throw err;
    }
  }, [address, isConnected, writeContractAsync, authFetch]);

  const reset = useCallback(() => setState({ step: 'idle', message: 'Ready.' }), []);

  return { state, createVaultJob, isPending, reset };
}
