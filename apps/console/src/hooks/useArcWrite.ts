'use client';

/**
 * Dual-mode contract write hook.
 *
 * Drop-in replacement for wagmi's useWriteContract that routes through:
 *   - Circle bundler + paymaster (gasless) when mode === 'passkey'
 *   - wagmi writeContractAsync (user pays gas) when mode === 'eoa'
 *
 * API shape stays identical so pages don't need changes:
 *   const { writeContractAsync, isPending } = useArcWrite();
 *   const txHash = await writeContractAsync({ address, abi, functionName, args });
 */

import { useCallback, useState } from 'react';
import { type Abi, type Address, encodeFunctionData } from 'viem';
import { useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from '@wagmi/core';
import { useArcWallet } from './useArcWallet';
import { config } from '@/lib/wagmi';

interface WriteConfig {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

export function useArcWrite() {
  const { mode, bundlerClient } = useArcWallet();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // wagmi hook for EOA path
  const { writeContractAsync: wagmiWrite } = useWriteContract();

  const writeContractAsync = useCallback(
    async (writeConfig: WriteConfig): Promise<`0x${string}`> => {
      if (!mode) {
        throw new Error('No wallet connected. Please connect first.');
      }

      setIsPending(true);
      setError(null);

      try {
        if (mode === 'passkey') {
          // ── Circle bundler path (gasless) ──────────────────────────
          if (!bundlerClient) {
            throw new Error('Circle bundler not ready. Try reconnecting.');
          }

          const callData = encodeFunctionData({
            abi: writeConfig.abi,
            functionName: writeConfig.functionName,
            args: writeConfig.args ?? [],
          });

          const userOpHash = await bundlerClient.sendUserOperation({
            calls: [
              {
                to: writeConfig.address,
                data: callData,
                value: writeConfig.value ?? BigInt(0),
              },
            ],
          });

          const { receipt } = await bundlerClient.waitForUserOperationReceipt({
            hash: userOpHash,
          });

          return receipt.transactionHash;
        } else {
          // ── EOA / wagmi path (user pays gas) ───────────────────────
          const hash = await wagmiWrite({
            address: writeConfig.address,
            abi: writeConfig.abi,
            functionName: writeConfig.functionName,
            args: writeConfig.args ? [...writeConfig.args] : [],
            value: writeConfig.value,
          });

          // Wait for inclusion so callers get a confirmed hash
          await waitForTransactionReceipt(config, { hash });

          return hash;
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsPending(false);
      }
    },
    [mode, bundlerClient, wagmiWrite],
  );

  return { writeContractAsync, isPending, error, mode };
}
