'use client';

/**
 * useAuthFetch — React hook for authenticated vault API calls.
 *
 * Uses useArcSign (dual-mode: passkey + EOA) to sign requests,
 * compatible with the server-side `withWalletAuth` middleware.
 */

import { useCallback } from 'react';
import { useArcWallet } from './useArcWallet';
import { useArcSign } from './useArcSign';

export function useAuthFetch() {
  const { address } = useArcWallet();
  const { signMessageAsync } = useArcSign();

  const authFetch = useCallback(
    async (url: string, opts: RequestInit = {}): Promise<Response> => {
      if (!address) throw new Error('Wallet not connected');

      const method = (opts.method || 'GET').toUpperCase();
      const path = new URL(url, window.location.origin).pathname;
      const nonce = crypto.randomUUID();
      const timestamp = Date.now();

      const message = [
        'ArcLayer Auth',
        `Wallet: ${address.toLowerCase()}`,
        `Method: ${method}`,
        `Path: ${path}`,
        `Nonce: ${nonce}`,
        `Timestamp: ${timestamp}`,
      ].join('\n');

      const signature = await signMessageAsync({ message });

      return fetch(url, {
        ...opts,
        method,
        headers: {
          ...(opts.headers as Record<string, string> | undefined),
          'content-type': 'application/json',
          'x-arc-wallet': address.toLowerCase(),
          'x-arc-nonce': nonce,
          'x-arc-timestamp': String(timestamp),
          'x-arc-signature': signature,
        },
      });
    },
    [address, signMessageAsync],
  );

  return { authFetch };
}
