'use client';

import { useCallback, useState } from 'react';
import {
  encodeFunctionData,
  getAddress,
  parseUnits,
  type Address,
} from 'viem';
import { useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from '@wagmi/core';
import { useArcWallet } from '@/hooks/useArcWallet';
import { config } from '@/lib/wagmi';
import { GATEWAY_WALLET_ABI } from '@/lib/x402/gateway/abi';
import {
  GATEWAY_WALLET_ADDRESS,
  USDC_ADDRESS,
} from '@/lib/x402/constants';

export type GatewayWithdrawStep =
  | 'idle'
  | 'checking'
  | 'initiating'
  | 'claiming'
  | 'confirming'
  | 'success'
  | 'error';

export interface GatewayWithdrawState {
  step: GatewayWithdrawStep;
  error: string | null;
  txHash: string | null;
  initiateWithdrawal: (amount: string) => Promise<void>;
  claimWithdrawal: () => Promise<void>;
  reset: () => void;
}

const GATEWAY_WALLET = getAddress(GATEWAY_WALLET_ADDRESS);
const USDC = getAddress(USDC_ADDRESS);

function isUserRejected(msg: string) {
  const lower = msg.toLowerCase();
  return (
    lower.includes('user rejected') ||
    lower.includes('user denied') ||
    lower.includes('user cancelled') ||
    lower.includes('user canceled')
  );
}

export function useGatewayWithdraw(onSuccess?: () => void): GatewayWithdrawState {
  const { mode, address, bundlerClient } = useArcWallet();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<GatewayWithdrawStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setTxHash(null);
  }, []);

  const initiateWithdrawal = useCallback(
    async (amount: string) => {
      if (!mode || !address) {
        setError('No wallet connected');
        setStep('error');
        return;
      }

      let amountUnits: bigint;

      try {
        amountUnits = parseUnits(amount || '0', 6);
      } catch {
        setError('Invalid amount');
        setStep('error');
        return;
      }

      if (amountUnits <= BigInt(0)) {
        setError('Amount must be greater than 0');
        setStep('error');
        return;
      }

      setStep('initiating');
      setError(null);
      setTxHash(null);

      try {
        if (mode === 'passkey') {
          if (!bundlerClient) {
            setError('Circle bundler not ready. Try reconnecting.');
            setStep('error');
            return;
          }

          const data = encodeFunctionData({
            abi: GATEWAY_WALLET_ABI,
            functionName: 'initiateWithdrawal',
            args: [USDC, amountUnits],
          });

          const userOpHash = await bundlerClient.sendUserOperation({
            calls: [
              {
                to: GATEWAY_WALLET,
                data,
                value: BigInt(0),
              },
            ],
          });

          setStep('confirming');

          const { receipt } = await bundlerClient.waitForUserOperationReceipt({
            hash: userOpHash,
          });

          setTxHash(receipt.transactionHash);
          setStep('success');
          onSuccess?.();
          return;
        }

        const hash = await writeContractAsync({
          address: GATEWAY_WALLET,
          abi: GATEWAY_WALLET_ABI,
          functionName: 'initiateWithdrawal',
          args: [USDC, amountUnits],
        });

        setStep('confirming');
        await waitForTransactionReceipt(config, { hash });

        setTxHash(hash);
        setStep('success');
        onSuccess?.();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        if (isUserRejected(msg)) {
          reset();
          return;
        }

        setError(msg);
        setStep('error');
      }
    },
    [mode, address, bundlerClient, writeContractAsync, onSuccess, reset],
  );

  const claimWithdrawal = useCallback(async () => {
    if (!mode || !address) {
      setError('No wallet connected');
      setStep('error');
      return;
    }

    setStep('claiming');
    setError(null);
    setTxHash(null);

    try {
      if (mode === 'passkey') {
        if (!bundlerClient) {
          setError('Circle bundler not ready. Try reconnecting.');
          setStep('error');
          return;
        }

        const data = encodeFunctionData({
          abi: GATEWAY_WALLET_ABI,
          functionName: 'withdraw',
          args: [USDC],
        });

        const userOpHash = await bundlerClient.sendUserOperation({
          calls: [
            {
              to: GATEWAY_WALLET,
              data,
              value: BigInt(0),
            },
          ],
        });

        setStep('confirming');

        const { receipt } = await bundlerClient.waitForUserOperationReceipt({
          hash: userOpHash,
        });

        setTxHash(receipt.transactionHash);
        setStep('success');
        onSuccess?.();
        return;
      }

      const hash = await writeContractAsync({
        address: GATEWAY_WALLET,
        abi: GATEWAY_WALLET_ABI,
        functionName: 'withdraw',
        args: [USDC],
      });

      setStep('confirming');
      await waitForTransactionReceipt(config, { hash });

      setTxHash(hash);
      setStep('success');
      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (isUserRejected(msg)) {
        reset();
        return;
      }

      setError(msg);
      setStep('error');
    }
  }, [mode, address, bundlerClient, writeContractAsync, onSuccess, reset]);

  return {
    step,
    error,
    txHash,
    initiateWithdrawal,
    claimWithdrawal,
    reset,
  };
}
