'use client';

/**
 * Dual-mode message signing hook.
 *
 * Drop-in replacement for wagmi's useSignMessage that routes through:
 *   - Circle smart account signMessage (passkey-backed) when mode === 'passkey'
 *   - wagmi signMessageAsync (EOA wallet prompt) when mode === 'eoa'
 *
 * API shape stays identical so callers don't need to branch:
 *   const { signMessageAsync, isPending } = useArcSign();
 *   const sig = await signMessageAsync({ message });
 */

import { useCallback, useState } from 'react';
import { useSignMessage } from 'wagmi';
import { useArcWallet } from './useArcWallet';

export function useArcSign() {
  const { mode, smartAccount } = useArcWallet();
  const [isPending, setIsPending] = useState(false);

  const { signMessageAsync: wagmiSign } = useSignMessage();

  const signMessageAsync = useCallback(
    async ({ message }: { message: string }): Promise<`0x${string}`> => {
      if (!mode) {
        throw new Error('No wallet connected. Please connect first.');
      }

      setIsPending(true);
      try {
        if (mode === 'passkey') {
          if (!smartAccount) {
            throw new Error('Circle smart account not ready. Try reconnecting.');
          }
          return await smartAccount.signMessage({ message });
        } else {
          // EOA path
          return await wagmiSign({ message });
        }
      } finally {
        setIsPending(false);
      }
    },
    [mode, smartAccount, wagmiSign],
  );

  return { signMessageAsync, isPending, mode };
}
