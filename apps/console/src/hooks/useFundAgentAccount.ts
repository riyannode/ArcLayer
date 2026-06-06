'use client';

/**
 * useFundAgentAccount — EOA → Agent Account USDC transfer.
 *
 * Transfers ERC-20 USDC from connected EOA to Circle Agent Account address.
 * Uses wagmi writeContractAsync (EOA signer, user pays gas).
 *
 * Safety:
 *   - Exact transfer amount (no unlimited approval)
 *   - Balance pre-check (reject if insufficient USDC)
 *   - Amount validation (> 0, max 6 decimals, no scientific notation)
 */

import { useCallback, useState } from 'react';
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseUnits,
  type Address,
} from 'viem';
import { arcTestnet } from '@arclayer/sdk';
import { useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from '@wagmi/core';
import { useArcWallet } from './useArcWallet';
import { config } from '@/lib/wagmi';
import { ERC20_ABI } from '@/lib/x402/gateway/abi';
import { USDC_ADDRESS } from '@/lib/x402/constants';

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const USDC = getAddress(USDC_ADDRESS);

export type FundStep =
  | 'idle'
  | 'checking'
  | 'transferring'
  | 'confirming'
  | 'success'
  | 'error';

export interface FundAgentAccountState {
  step: FundStep;
  error: string | null;
  txHash: string | null;
  /** Execute transfer. Amount in human-readable USDC (e.g. "1.00"). */
  fund: (amount: string, toAddress: string) => Promise<void>;
  /** Reset state back to idle. */
  reset: () => void;
}

export function useFundAgentAccount(
  onSuccess?: () => void,
): FundAgentAccountState {
  const { mode, address } = useArcWallet();
  const { writeContractAsync: wagmiWrite } = useWriteContract();

  const [step, setStep] = useState<FundStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setTxHash(null);
  }, []);

  const fund = useCallback(
    async (amount: string, toAddress: string) => {
      if (!mode || !address) {
        setError('No wallet connected');
        setStep('error');
        return;
      }

      if (!toAddress || !isAddress(toAddress)) {
        setError('Invalid Agent Account address');
        setStep('error');
        return;
      }

      setStep('checking');
      setError(null);
      setTxHash(null);

      try {
        // Validate amount string before parsing
        const trimmed = amount.trim();
        if (!trimmed || !/^\d+(\.\d{1,6})?$/.test(trimmed)) {
          setError('Enter a valid amount with up to 6 decimals (e.g. 1.50)');
          setStep('error');
          return;
        }

        const amountUnits = parseUnits(trimmed, 6);
        if (amountUnits <= BigInt(0)) {
          setError('Amount must be greater than 0');
          setStep('error');
          return;
        }

        const publicClient = createPublicClient({
          chain: arcTestnet,
          transport: http(ARC_RPC),
        });

        // Pre-flight: check EOA USDC balance
        const balance = await publicClient.readContract({
          address: USDC,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address as Address],
        });

        if (balance < amountUnits) {
          setError(
            `Insufficient USDC. Have ${formatUnits(balance, 6)}, need ${trimmed}.`,
          );
          setStep('error');
          return;
        }

        // Transfer USDC from EOA to Agent Account
        setStep('transferring');
        const transferHash = await wagmiWrite({
          address: USDC,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [getAddress(toAddress) as Address, amountUnits],
        });

        setStep('confirming');
        await waitForTransactionReceipt(config, { hash: transferHash });

        setTxHash(transferHash);
        setStep('success');
        onSuccess?.();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('User rejected') || msg.includes('user rejected')) {
          reset();
          return;
        }
        setError(msg);
        setStep('error');
      }
    },
    [mode, address, wagmiWrite, onSuccess, reset],
  );

  return { step, error, txHash, fund, reset };
}
