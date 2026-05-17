'use client';

import { useCallback, useState } from 'react';
import { type Abi, type Address, encodeFunctionData } from 'viem';
import { useCircleWallet } from './useCircleWallet';

interface WriteConfig {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

/**
 * Drop-in replacement for wagmi's useWriteContract.
 * Sends gasless userOps via Circle bundler + paymaster.
 * Returns the included transaction hash (same shape as wagmi).
 *
 * Usage:
 *   const { writeContractAsync, isPending } = useArcWrite();
 *   const txHash = await writeContractAsync({ address, abi, functionName, args });
 */
export function useArcWrite() {
  const { bundlerClient } = useCircleWallet();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const writeContractAsync = useCallback(
    async (config: WriteConfig): Promise<`0x${string}`> => {
      if (!bundlerClient) {
        throw new Error('Wallet not connected. Please login first.');
      }

      setIsPending(true);
      setError(null);

      try {
        const callData = encodeFunctionData({
          abi: config.abi,
          functionName: config.functionName,
          args: config.args ?? [],
        });

        const userOpHash = await bundlerClient.sendUserOperation({
          calls: [
            {
              to: config.address,
              data: callData,
              value: config.value ?? BigInt(0),
            },
          ],
        });

        // Wait for the userOp to be included and return the tx hash
        const { receipt } = await bundlerClient.waitForUserOperationReceipt({
          hash: userOpHash,
        });

        return receipt.transactionHash;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsPending(false);
      }
    },
    [bundlerClient],
  );

  return { writeContractAsync, isPending, error };
}
