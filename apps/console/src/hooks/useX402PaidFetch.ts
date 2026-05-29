'use client';

import { useCallback } from 'react';
import { useAccount } from 'wagmi';
import { switchChain } from '@wagmi/core';
import { config } from '@/lib/wagmi';
import { createPublicClient, formatUnits, getAddress, http, type Hex } from 'viem';

const ARC_CHAIN_ID = 5042002;
const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.drpc.testnet.arc.network';
const USDC = getAddress('0x3600000000000000000000000000000000000000');

const BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

interface Requirement {
  scheme: 'exact';
  network: string;
  asset: `0x${string}`;
  amount: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface X402PaidFetchResult {
  ok: boolean;
  status: number;
  json: any;
  paymentTxHash?: string;
  error?: string;
}

function randomNonce(): Hex {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex;
}

function b64(value: unknown) {
  return btoa(JSON.stringify(value));
}

async function parseJsonSafe(response: Response): Promise<any> {
  return response.json().catch(() => ({}));
}

function parsePaymentResponseHeaderSafe(headerValue: string): { transaction?: string; txHash?: string } | null {
  try {
    const normalized = headerValue.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(atob(padded)) as { transaction?: string; txHash?: string };
  } catch {
    return null;
  }
}

export function useX402PaidFetch() {
  const { address: eoaAddress, isConnected: eoaConnected, connector } = useAccount();

  const paidFetch = useCallback(
    async (path: string, init?: RequestInit): Promise<X402PaidFetchResult> => {
      if (!eoaConnected || !eoaAddress) {
        return {
          ok: false,
          status: 0,
          json: null,
          error: 'EOA wallet not connected. Please connect MetaMask or another EOA wallet.',
        };
      }

      const payer = eoaAddress as `0x${string}`;

      try {
        await switchChain(config, { chainId: ARC_CHAIN_ID });
      } catch (e) {
        return {
          ok: false,
          status: 0,
          json: null,
          error: `Failed to switch to Arc Testnet: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      const challengeUrl = new URL(path, window.location.origin);
      challengeUrl.searchParams.set('rail', 'arc-native-eoa');
      challengeUrl.searchParams.set('payer', payer);

      const originalHeaders = new Headers(init?.headers);
      const challengeRes = await fetch(challengeUrl.toString(), {
        ...init,
        headers: originalHeaders,
      });

      const challengeJson = await parseJsonSafe(challengeRes);
      if (challengeRes.status !== 402) {
        return {
          ok: challengeRes.ok,
          status: challengeRes.status,
          json: challengeJson,
          error: challengeRes.ok ? undefined : challengeJson?.error || challengeJson?.message,
        };
      }

      const accepts = Array.isArray(challengeJson?.accepts) ? (challengeJson.accepts as Requirement[]) : undefined;
      if (!accepts?.length) {
        return {
          ok: false,
          status: 402,
          json: challengeJson,
          error: 'No 402 accepts were returned by the server.',
        };
      }

      const req = accepts.find((a) => {
        const asset = getAddress(a.asset);
        const name = typeof a.extra?.name === 'string' ? a.extra.name.toLowerCase() : '';
        return asset === USDC && (name === '' || name === 'usdc');
      });

      if (!req) {
        return {
          ok: false,
          status: 402,
          json: challengeJson,
          error: 'No Arc Native EOA USDC payment requirement was returned by the server.',
        };
      }

      const client = createPublicClient({ transport: http(ARC_RPC) });
      const requiredAmount = BigInt(req.amount);
      let availableBalance: bigint;
      try {
        availableBalance = (await client.readContract({
          address: USDC,
          abi: BALANCE_ABI,
          functionName: 'balanceOf',
          args: [payer],
        })) as bigint;
      } catch {
        return {
          ok: false,
          status: 0,
          json: challengeJson,
          error: 'Failed to read USDC balance.',
        };
      }

      if (availableBalance < requiredAmount) {
        return {
          ok: false,
          status: 402,
          json: challengeJson,
          error: `Insufficient USDC. Need ${formatUnits(requiredAmount, 6)} USDC, have ${formatUnits(availableBalance, 6)} USDC.`,
        };
      }

      const validBefore = String(Math.floor(Date.now() / 1000) + 600);
      const nonce = randomNonce();

      const paymentPayload = {
        x402Version: 2,
        accepted: {
          ...req,
          asset: getAddress(req.asset),
          payTo: getAddress(req.payTo),
          extra: {
           ...(req.extra ?? {}),
           name: typeof req.extra?.name === 'string' ? req.extra.name : 'USDC',
           version: typeof req.extra?.version === 'string' ? req.extra.version : '2',
           decimals: typeof req.extra?.decimals === 'number' ? req.extra.decimals : 6,
           symbol: typeof req.extra?.symbol === 'string' ? req.extra.symbol : 'USDC',
           transferMethod:
             typeof req.extra?.transferMethod === 'string'
               ? req.extra.transferMethod
               : 'eip3009',
         },
        },
        payload: {
          signature: '0x' as Hex,
          authorization: {
            from: payer,
            to: getAddress(req.payTo),
            value: req.amount,
            validAfter: '0',
            validBefore,
            nonce,
          },
        },
      };

      try {
        if (!connector) throw new Error('No wallet connector active.');
        const provider = (await connector.getProvider()) as {
          request: (args: { method: string; params: unknown[] }) => Promise<unknown>;
        };

        paymentPayload.payload.signature = (await provider.request({
          method: 'eth_signTypedData_v4',
          params: [
            payer,
            JSON.stringify({
              types: {
                EIP712Domain: [
                  { name: 'name', type: 'string' },
                  { name: 'version', type: 'string' },
                  { name: 'chainId', type: 'uint256' },
                  { name: 'verifyingContract', type: 'address' },
                ],
                TransferWithAuthorization: [
                  { name: 'from', type: 'address' },
                  { name: 'to', type: 'address' },
                  { name: 'value', type: 'uint256' },
                  { name: 'validAfter', type: 'uint256' },
                  { name: 'validBefore', type: 'uint256' },
                  { name: 'nonce', type: 'bytes32' },
                ],
              },
              primaryType: 'TransferWithAuthorization',
              domain: {
                name: 'USDC',
                version: '2',
                chainId: ARC_CHAIN_ID,
                verifyingContract: USDC,
              },
              message: {
                from: payer,
                to: getAddress(req.payTo),
                value: `0x${requiredAmount.toString(16)}`,
                validAfter: '0x0',
                validBefore: `0x${BigInt(validBefore).toString(16)}`,
                nonce,
              },
            }),
          ],
        })) as Hex;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/user rejected|denied/i.test(msg)) {
          return { ok: false, status: 402, json: challengeJson, error: 'Payment cancelled.' };
        }
        return { ok: false, status: 402, json: challengeJson, error: `Signature failed: ${msg}` };
      }

     const retryHeaders = new Headers(originalHeaders);
     retryHeaders.set('PAYMENT-SIGNATURE', b64(paymentPayload));

      const paidRes = await fetch(path, {
        ...init,
        headers: retryHeaders,
      });

      const paidJson = await parseJsonSafe(paidRes);
      let paymentTxHash: string | undefined;
      const paymentResponseHeader = paidRes.headers.get('PAYMENT-RESPONSE');
      if (paymentResponseHeader) {
        const parsed = parsePaymentResponseHeaderSafe(paymentResponseHeader);
        paymentTxHash = parsed?.transaction || parsed?.txHash;
      }

      if (!paidRes.ok) {
        return {
          ok: false,
          status: paidRes.status,
          json: paidJson,
          paymentTxHash,
          error: paidJson?.error || paidJson?.message || `HTTP ${paidRes.status}`,
        };
      }

      return {
        ok: true,
        status: paidRes.status,
        json: paidJson,
        paymentTxHash,
      };
    },
    [eoaConnected, eoaAddress, connector],
  );

  return { paidFetch };
}
