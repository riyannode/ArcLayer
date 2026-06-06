'use client';

/**
 * useAgentAccountGatewayDeposit — Agent Account → Circle GatewayWallet deposit.
 *
 * Routes through Circle Smart Account (ERC-4337 bundler):
 *   USDC.approve(GatewayWallet, amount) + GatewayWallet.deposit(USDC, amount)
 *   as a single batched userOperation. msg.sender = Agent Account address.
 *
 * GatewayWallet.deposits(agentAccountAddress, USDC) increases after deposit.
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
import { arcTestnet } from '@arclayer/sdk';
import type { BundlerClient } from 'viem/account-abstraction';
import { ERC20_ABI, GATEWAY_WALLET_ABI } from '@/lib/x402/gateway/abi';
import { GATEWAY_WALLET_ADDRESS, USDC_ADDRESS } from '@/lib/x402/constants';

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const GATEWAY_WALLET = getAddress(GATEWAY_WALLET_ADDRESS);
const USDC = getAddress(USDC_ADDRESS);

export type AgentDepositStep =
  | 'idle'
  | 'checking'       // pre-flight: balance + allowance check
  | 'depositing'     // userOp in progress (approve + deposit batched)
  | 'confirming'     // waiting for userOp receipt
  | 'success'
  | 'error';

export interface AgentAccountGatewayDepositState {
  step: AgentDepositStep;
  error: string | null;
  userOpHash: string | null;
  txHash: string | null;
  /** Execute deposit. Amount in human-readable USDC (e.g. "1.00"). */
  deposit: (amount: string, agentAccountAddress: string) => Promise<void>;
  /** Reset state back to idle. */
  reset: () => void;
}

export function useAgentAccountGatewayDeposit(
  bundlerClient: BundlerClient | null,
  onSuccess?: () => void,
): AgentAccountGatewayDepositState {
  const [step, setStep] = useState<AgentDepositStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [userOpHash, setUserOpHash] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setUserOpHash(null);
    setTxHash(null);
  }, []);

  const deposit = useCallback(
    async (amount: string, agentAccountAddress: string) => {
      if (!bundlerClient) {
        setError('Circle Agent Account not connected. Login with passkey first.');
        setStep('error');
        return;
      }

      if (!agentAccountAddress || !getAddress(agentAccountAddress)) {
        setError('Invalid Agent Account address');
        setStep('error');
        return;
      }

      setStep('checking');
      setError(null);
      setUserOpHash(null);
      setTxHash(null);

      const agentAddr = getAddress(agentAccountAddress);
      const amountUnits = parseUnits(amount, 6);
      if (amountUnits <= BigInt(0)) {
        setError('Amount must be greater than 0');
        setStep('error');
        return;
      }

      try {
        const publicClient = createPublicClient({
          chain: arcTestnet,
          transport: http(ARC_RPC),
        });

        // ── Pre-flight: check Agent Account USDC balance ──────────────
        const balance = await publicClient.readContract({
          address: USDC,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [agentAddr],
        });

        if (balance < amountUnits) {
          setError(
            `Insufficient USDC on Agent Account. Have ${formatUnits(balance, 6)}, need ${amount}.`,
          );
          setStep('error');
          return;
        }

        // ── Pre-flight: check existing allowance ─────────────────────
        const allowance = await publicClient.readContract({
          address: USDC,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [agentAddr, GATEWAY_WALLET],
        });

        // ── Build calls ───────────────────────────────────────────────
        const calls: { to: Address; data: `0x${string}`; value?: bigint }[] = [];

        if (allowance < amountUnits) {
          // USDC.approve(GatewayWallet, amount)
          calls.push({
            to: USDC,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [GATEWAY_WALLET, amountUnits],
            }),
          });
        }

        // GatewayWallet.deposit(USDC, amount)
        calls.push({
          to: GATEWAY_WALLET,
          data: encodeFunctionData({
            abi: GATEWAY_WALLET_ABI,
            functionName: 'deposit',
            args: [USDC, amountUnits],
          }),
        });

        // ── Send batched userOp ───────────────────────────────────────
        setStep('depositing');
        const hash = await bundlerClient.sendUserOperation({ calls });
        setUserOpHash(hash);

        // ── Wait for userOp receipt ───────────────────────────────────
        setStep('confirming');
        const receipt = await bundlerClient.waitForUserOperationReceipt({
          hash,
        });

        setTxHash(receipt.receipt.transactionHash);
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
    [bundlerClient, onSuccess, reset],
  );

  return { step, error, userOpHash, txHash, deposit, reset };
}
