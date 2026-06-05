'use client';

/**
 * EOA-only contract write hook.
 *
 * Drop-in replacement for wagmi's useWriteContract.
 * Uses EOA wallet for transactions (user pays gas).
 *
 *   const { writeContractAsync, isPending } = useArcWrite();
 *   const txHash = await writeContractAsync({ address, abi, functionName, args });
 */

import { useCallback, useState } from 'react';
import { type Abi, type Address } from 'viem';
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
  const { mode } = useArcWallet();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { writeContractAsync: wagmiWrite } = useWriteContract();

  const writeContractAsync = useCallback(
    async (writeConfig: WriteConfig): Promise<`0x${string}`> => {
      if (!mode) {
        throw new Error('No wallet connected. Please connect first.');
      }

      setIsPending(true);
      setError(null);

      try {
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
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsPending(false);
      }
    },
    [mode, wagmiWrite],
  );

  return { writeContractAsync, isPending, error, mode };
}
