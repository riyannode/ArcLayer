'use client';

/**
 * EOA-only message signing hook.
 *
 * Drop-in replacement for wagmi's useSignMessage.
 * Uses EOA wallet prompt for signing.
 *
 *   const { signMessageAsync, isPending } = useArcSign();
 *   const sig = await signMessageAsync({ message });
 */

import { useCallback, useState } from 'react';
import { useSignMessage } from 'wagmi';
import { useArcWallet } from './useArcWallet';

export function useArcSign() {
  const { mode } = useArcWallet();
  const [isPending, setIsPending] = useState(false);

  const { signMessageAsync: wagmiSign } = useSignMessage();

  const signMessageAsync = useCallback(
    async ({ message }: { message: string }): Promise<`0x${string}`> => {
      if (!mode) {
        throw new Error('No wallet connected. Please connect first.');
      }

      setIsPending(true);
      try {
        return await wagmiSign({ message });
      } finally {
        setIsPending(false);
      }
    },
    [mode, wagmiSign],
  );

  return { signMessageAsync, isPending, mode };
}
