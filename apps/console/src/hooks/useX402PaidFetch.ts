'use client';

import { useCallback } from 'react';
import { useAccount } from 'wagmi';
import { switchChain } from '@wagmi/core';
import { config } from '@/lib/wagmi';
import { getAddress, type Hex } from 'viem';

const ARC_CHAIN_ID = 5042002;
const USDC = getAddress('0x3600000000000000000000000000000000000000');

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

function b64(value: unknown): string {
  return btoa(JSON.stringify(value));
}

export function parsePaymentResponseTxHash(paymentResponse: string | null): string | undefined {
  if (!paymentResponse) return undefined;
  try {
    const parsed = JSON.parse(atob(paymentResponse));
    return parsed?.transaction || parsed?.txHash;
  } catch {
    return undefined;
  }
}

export async function createArcNativePaymentHeader(args: {
  connector: { getProvider: () => Promise<{ request: (args: { method: string; params: unknown[] }) => Promise<unknown> }> };
  payer: `0x${string}`;
  requirement: Requirement;
}): Promise<string> {
  const { connector, payer, requirement } = args;
  const validBefore = String(Math.floor(Date.now() / 1000) + 600);
  const nonce = randomNonce();

  const paymentPayload = {
    x402Version: 2,
    accepted: {
      ...requirement,
      asset: getAddress(requirement.asset),
      payTo: getAddress(requirement.payTo),
      extra: { name: 'USDC', version: '2', decimals: 6, symbol: 'USDC' },
    },
    payload: {
      signature: '0x' as Hex,
      authorization: {
        from: payer,
        to: getAddress(requirement.payTo),
        value: requirement.amount,
        validAfter: '0',
        validBefore,
        nonce,
      },
    },
  };

  const provider = await connector.getProvider();
  const signature = (await provider.request({
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
          to: getAddress(requirement.payTo),
          value: `0x${BigInt(requirement.amount).toString(16)}`,
          validAfter: '0x0',
          validBefore: `0x${BigInt(validBefore).toString(16)}`,
          nonce,
        },
      }),
    ],
  })) as Hex;

  paymentPayload.payload.signature = signature;
  return b64(paymentPayload);
}

export function useX402PaidFetch() {
  const { address: eoaAddress, isConnected: eoaConnected, connector } = useAccount();

  const paidFetch = useCallback(async (path: string, init?: RequestInit): Promise<X402PaidFetchResult> => {
    const method = init?.method ?? 'GET';
    const originalHeaders = new Headers(init?.headers ?? {});

    const firstRes = await fetch(path, { ...init, method, headers: originalHeaders });
    const firstJson = await firstRes.json().catch(() => ({}));

    if (firstRes.status !== 402) {
      return { ok: firstRes.ok, status: firstRes.status, json: firstJson };
    }

    if (!eoaConnected || !eoaAddress) {
      return {
        ok: false,
        status: 402,
        json: firstJson,
        error: 'EOA wallet not connected. Please connect MetaMask or another EOA wallet.',
      };
    }

    if (!Array.isArray(firstJson?.accepts)) {
      return { ok: false, status: 402, json: firstJson, error: 'Payment challenge missing accepts array.' };
    }

    const req = (firstJson.accepts as Requirement[]).find(
      (a) => getAddress(a.asset) === USDC && (!a.extra?.name || a.extra?.name === 'USDC')
    );

    if (!req) {
      return { ok: false, status: 402, json: firstJson, error: 'No Arc Native EOA USDC requirement found.' };
    }

    try {
      await switchChain(config, { chainId: ARC_CHAIN_ID });
      if (!connector) throw new Error('No wallet connector active.');
      const paymentHeader = await createArcNativePaymentHeader({
        connector,
        payer: eoaAddress as `0x${string}`,
        requirement: req,
      });

      const retryHeaders = new Headers(init?.headers ?? {});
      retryHeaders.set('X-PAYMENT', paymentHeader);

      const paidRes = await fetch(path, { ...init, method, headers: retryHeaders });
      const paidJson = await paidRes.json().catch(() => ({}));
      const paymentTxHash = parsePaymentResponseTxHash(paidRes.headers.get('PAYMENT-RESPONSE'));

      return {
        ok: paidRes.ok,
        status: paidRes.status,
        json: paidJson,
        paymentTxHash,
        error: paidRes.ok ? undefined : paidJson?.error || paidJson?.message || `HTTP ${paidRes.status}`,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/user rejected|denied/i.test(msg)) {
        return { ok: false, status: 402, json: firstJson, error: 'Payment cancelled.' };
      }
      return { ok: false, status: 402, json: firstJson, error: `Payment signing failed: ${msg}` };
    }
  }, [eoaConnected, eoaAddress, connector]);

  return { paidFetch };
}
