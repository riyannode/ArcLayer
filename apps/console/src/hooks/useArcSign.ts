'use client';

import { useCallback, useState } from 'react';
import { useCircleWallet } from './useCircleWallet';

/**
 * Drop-in replacement for wagmi's useSignMessage.
 * Signs messages using the Circle smart account (passkey-backed).
 */
export function useArcSign() {
  const { smartAccount } = useCircleWallet();
  const [isPending, setIsPending] = useState(false);

  const signMessageAsync = useCallback(
    async ({ message }: { message: string }): Promise<`0x${string}`> => {
      if (!smartAccount) {
        throw new Error('Wallet not connected. Please login first.');
      }

      setIsPending(true);
      try {
        const signature = await smartAccount.signMessage({ message });
        return signature;
      } finally {
        setIsPending(false);
      }
    },
    [smartAccount],
  );

  return { signMessageAsync, isPending };
}
