/**
 * Authenticated fetch for vault API — signs requests with wallet.
 *
 * Client-side counterpart to `lib/auth/wallet-auth.ts` server verification.
 * Uses EIP-191 personal_sign over canonical message.
 */

import type { WalletClient } from 'viem';

export interface AuthFetchOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
}

/**
 * Build auth headers for a vault API request.
 * Requires a connected wallet client that can sign messages.
 */
export async function buildAuthHeaders(params: {
  walletClient: WalletClient;
  address: `0x${string}`;
  method: string;
  path: string;
}): Promise<Record<string, string>> {
  const { walletClient, address, method, path } = params;
  const nonce = crypto.randomUUID();
  const timestamp = Date.now();

  const message = [
    'ArcLayer Auth',
    `Wallet: ${address.toLowerCase()}`,
    `Method: ${method.toUpperCase()}`,
    `Path: ${path}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
  ].join('\n');

  const signature = await walletClient.signMessage({
    account: address,
    message,
  });

  return {
    'x-arc-wallet': address.toLowerCase(),
    'x-arc-nonce': nonce,
    'x-arc-timestamp': String(timestamp),
    'x-arc-signature': signature,
  };
}

/**
 * Authenticated fetch wrapper — signs the request before sending.
 */
export async function authFetch(
  url: string,
  opts: AuthFetchOptions & {
    walletClient: WalletClient;
    address: `0x${string}`;
  },
): Promise<Response> {
  const { walletClient, address, ...fetchOpts } = opts;
  const method = (fetchOpts.method || 'GET').toUpperCase();
  const path = new URL(url, window.location.origin).pathname;

  const authHeaders = await buildAuthHeaders({
    walletClient,
    address,
    method,
    path,
  });

  return fetch(url, {
    ...fetchOpts,
    method,
    headers: {
      ...fetchOpts.headers,
      ...authHeaders,
    },
  });
}
