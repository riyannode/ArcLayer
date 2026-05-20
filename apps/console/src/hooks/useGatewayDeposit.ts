'use client';

/**
 * useGatewayDeposit — Hybrid deposit hook for Circle GatewayWallet.
 *
 * Routes through:
 *   - EOA (Reown/wagmi): sequential approve → deposit (user pays gas)
 *   - Passkey (Circle bundler): atomic userOp [approve, deposit] (gasless)
 *
 * Safety:
 *   - Exact approve amount (no unlimited allowance)
 *   - Allowance pre-check (skip approve if sufficient)
 *   - Balance pre-check (reject if insufficient USDC)
 *   - Auto-refresh gateway balance after success
 */

import { useCallback, useState } from 'react';
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  parseUnits,
  type Address,
} from 'viem';
import { useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from '@wagmi/core';
import { useArcWallet } from './useArcWallet';
import { config } from '@/lib/wagmi';
import { GATEWAY_WALLET_ABI, ERC20_ABI } from '@/lib/x402/gateway/abi';
import {
  GATEWAY_WALLET_ADDRESS,
  USDC_ADDRESS,
} from '@/lib/x402/constants';

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const GATEWAY_WALLET = getAddress(GATEWAY_WALLET_ADDRESS);
const USDC = getAddress(USDC_ADDRESS);

export type DepositStep =
  | 'idle'
  | 'checking'       // pre-flight: balance + allowance check
  | 'approving'      // approve tx in progress (EOA only, skipped if allowance ok)
  | 'depositing'     // deposit tx in progress
  | 'confirming'     // waiting for on-chain confirmation
  | 'success'
  | 'error';

export interface GatewayDepositState {
  step: DepositStep;
  error: string | null;
  txHash: string | null;
  approveTxHash: string | null;
  /** Execute deposit. Amount in human-readable USDC (e.g. "1.00"). */
  deposit: (amount: string) => Promise<void>;
  /** Reset state back to idle. */
  reset: () => void;
}

export function useGatewayDeposit(
  onSuccess?: () => void,
): GatewayDepositState {
  const { mode, address, bundlerClient } = useArcWallet();
  const { writeContractAsync: wagmiWrite } = useWriteContract();

  const [step, setStep] = useState<DepositStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [approveTxHash, setApproveTxHash] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setTxHash(null);
    setApproveTxHash(null);
  }, []);

  const deposit = useCallback(
    async (amount: string) => {
      if (!mode || !address) {
        setError('No wallet connected');
        setStep('error');
        return;
      }

      setStep('checking');
      setError(null);
      setTxHash(null);
      setApproveTxHash(null);

      const amountUnits = parseUnits(amount, 6);
      if (amountUnits <= BigInt(0)) {
        setError('Amount must be greater than 0');
        setStep('error');
        return;
      }

      try {
        const publicClient = createPublicClient({ transport: http(ARC_RPC) });

        // ── Pre-flight: check USDC balance ──────────────────────────────
        const balance = await publicClient.readContract({
          address: USDC,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address as Address],
        });

        if (balance < amountUnits) {
          setError(
            `Insufficient USDC. Have ${formatUnits(balance, 6)}, need ${amount}.`,
          );
          setStep('error');
          return;
        }

        // ── Pre-flight: check existing allowance ────────────────────────
        const allowance = await publicClient.readContract({
          address: USDC,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address as Address, GATEWAY_WALLET],
        });

        const needsApprove = allowance < amountUnits;

        if (mode === 'passkey') {
          // ── PASSKEY PATH: atomic userOp via Circle bundler ─────────────
          if (!bundlerClient) {
            setError('Circle bundler not ready. Try reconnecting.');
            setStep('error');
            return;
          }

          setStep(needsApprove ? 'approving' : 'depositing');

          const calls: Array<{ to: Address; data: `0x${string}`; value: bigint }> = [];

          if (needsApprove) {
            calls.push({
              to: USDC,
              data: encodeFunctionData({
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [GATEWAY_WALLET, amountUnits],
              }),
              value: BigInt(0),
            });
          }

          calls.push({
            to: GATEWAY_WALLET,
            data: encodeFunctionData({
              abi: GATEWAY_WALLET_ABI,
              functionName: 'deposit',
              args: [USDC, amountUnits],
            }),
            value: BigInt(0),
          });

          setStep('depositing');
          const userOpHash = await bundlerClient.sendUserOperation({ calls });

          setStep('confirming');
          const { receipt } = await bundlerClient.waitForUserOperationReceipt({
            hash: userOpHash,
          });

          setTxHash(receipt.transactionHash);
          setStep('success');
          onSuccess?.();
        } else {
          // ── EOA PATH: sequential approve → deposit via Reown/wagmi ─────
          if (needsApprove) {
            setStep('approving');
            const approveHash = await wagmiWrite({
              address: USDC,
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [GATEWAY_WALLET, amountUnits],
            });
            await waitForTransactionReceipt(config, { hash: approveHash });
            setApproveTxHash(approveHash);
          }

          setStep('depositing');
          const depositHash = await wagmiWrite({
            address: GATEWAY_WALLET,
            abi: GATEWAY_WALLET_ABI,
            functionName: 'deposit',
            args: [USDC, amountUnits],
          });

          setStep('confirming');
          await waitForTransactionReceipt(config, { hash: depositHash });

          setTxHash(depositHash);
          setStep('success');
          onSuccess?.();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // User rejected in wallet — don't show as error, just reset
        if (msg.includes('User rejected') || msg.includes('user rejected')) {
          reset();
          return;
        }
        setError(msg);
        setStep('error');
      }
    },
    [mode, address, bundlerClient, wagmiWrite, onSuccess, reset],
  );

  return { step, error, txHash, approveTxHash, deposit, reset };
}
