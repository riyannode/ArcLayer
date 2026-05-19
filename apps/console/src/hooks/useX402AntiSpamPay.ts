'use client';

/**
 * useX402AntiSpamPay — minimal one-shot x402 payment for anti-spam action gates.
 *
 * Targets a server route protected by `withX402(...)` and returns once the
 * payment is settled on-chain. Only supports the Arc Native EOA rail
 * (EIP-3009 transferWithAuthorization).
 *
 * Passkey/Circle Gateway is intentionally NOT supported here — anti-spam fees
 * are designed to be paid in one click from a regular wallet. If the connected
 * wallet is a passkey smart account, the caller should surface a notice asking
 * the user to switch to an EOA wallet for the registration fee.
 *
 * Usage:
 *   const { pay } = useX402AntiSpamPay({ resource: '/api/x402/register-gate' });
 *   const { ok, txHash, error } = await pay();
 *   if (ok) await writeContractAsync(...);
 */
import { useCallback } from 'react';
import { useAccount } from 'wagmi';
import { switchChain } from '@wagmi/core';
import { config } from '@/lib/wagmi';
import { createPublicClient, formatUnits, getAddress, http, type Hex } from 'viem';

const ARC_CHAIN_ID = 5042002;
const ARC_RPC = 'https://rpc.testnet.arc.network';
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

export interface X402PayResult {
  ok: boolean;
  txHash?: string;
  amount?: string;
  error?: string;
}

interface UseX402AntiSpamPayOpts {
  /** Server resource path protected by withX402 (e.g. '/api/x402/register-gate') */
  resource: string;
  /** Optional progress callback */
  onProgress?: (msg: string) => void;
}

function randomNonce(): Hex {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex;
}

function b64(value: unknown) {
  return btoa(JSON.stringify(value));
}

export function useX402AntiSpamPay({ resource, onProgress }: UseX402AntiSpamPayOpts) {
  const { address: eoaAddress, isConnected: eoaConnected, connector } = useAccount();

  const pay = useCallback(async (): Promise<X402PayResult> => {
    if (!eoaConnected || !eoaAddress) {
      return { ok: false, error: 'EOA wallet not connected. Please connect MetaMask or another EOA wallet.' };
    }

    const payer = eoaAddress as `0x${string}`;
    const log = (m: string) => onProgress?.(m);

    // Ensure correct chain
    try {
      await switchChain(config, { chainId: ARC_CHAIN_ID });
    } catch (e) {
      return {
        ok: false,
        error: `Failed to switch to Arc Testnet: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // 1) Fetch 402 challenge with payer hint
    log('Requesting payment challenge…');
    const challengeUrl = `${resource}?rail=arc-native-eoa&payer=${encodeURIComponent(payer)}`;
    const challengeRes = await fetch(challengeUrl);
    const challenge = await challengeRes.json().catch(() => ({}));

    if (challengeRes.status !== 402 || !Array.isArray(challenge.accepts)) {
      return {
        ok: false,
        error: `Endpoint did not return x402 challenge (status ${challengeRes.status}).`,
      };
    }

    const accepts = challenge.accepts as Requirement[];
    const req =
      accepts.find((a) => !a.extra?.name || a.extra?.name === 'USDC') || accepts[0];
    if (!req) return { ok: false, error: 'No payment requirement returned.' };

    const humanAmount = formatUnits(BigInt(req.amount), 6);
    log(`Fee: ${humanAmount} USDC. Checking balance…`);

    // 2) Check USDC balance
    const client = createPublicClient({ transport: http(ARC_RPC) });
    let balance: bigint;
    try {
      balance = (await client.readContract({
        address: USDC,
        abi: BALANCE_ABI,
        functionName: 'balanceOf',
        args: [payer],
      })) as bigint;
    } catch (e) {
      return {
        ok: false,
        error: `Failed to read USDC balance: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    if (balance < BigInt(req.amount)) {
      return {
        ok: false,
        error: `Insufficient USDC. Need ${humanAmount} USDC, have ${formatUnits(balance, 6)} USDC.`,
      };
    }

    // 3) Sign EIP-3009 transferWithAuthorization
    log('Sign payment authorization in your wallet…');
    const validBefore = String(Math.floor(Date.now() / 1000) + 600);
    const nonce = randomNonce();

    const paymentPayload = {
      x402Version: 2,
      accepted: {
        ...req,
        asset: getAddress(req.asset),
        payTo: getAddress(req.payTo),
        extra: { name: 'USDC', version: '2', decimals: 6, symbol: 'USDC' },
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

    let signature: Hex;
    try {
      if (!connector) throw new Error('No wallet connector active.');
      const provider = (await connector.getProvider()) as {
        request: (args: { method: string; params: unknown[] }) => Promise<unknown>;
      };
      signature = (await provider.request({
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
              value: `0x${BigInt(req.amount).toString(16)}`,
              validAfter: '0x0',
              validBefore: `0x${BigInt(validBefore).toString(16)}`,
              nonce,
            },
          }),
        ],
      })) as Hex;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // User rejection → friendly message
      if (/user rejected|denied/i.test(msg)) {
        return { ok: false, error: 'Payment cancelled. Registration not submitted.' };
      }
      return { ok: false, error: `Signature failed: ${msg}` };
    }
    paymentPayload.payload.signature = signature;

    // 4) Submit payment to protected endpoint
    log('Settling payment on-chain…');
    const header = b64(paymentPayload);
    const settleRes = await fetch(resource, {
      method: 'GET',
      headers: { 'X-PAYMENT': header },
    });
    const settleJson = await settleRes.json().catch(() => ({}));

    if (!settleRes.ok || !settleJson.unlocked) {
      const reason =
        settleJson.error || settleJson.reason || settleJson.message || `HTTP ${settleRes.status}`;
      return { ok: false, error: `Payment rejected: ${reason}` };
    }

    // PAYMENT-RESPONSE header carries txHash
    const respHeader = settleRes.headers.get('PAYMENT-RESPONSE');
    let txHash: string | undefined;
    if (respHeader) {
      try {
        const parsed = JSON.parse(atob(respHeader));
        txHash = parsed?.transaction || parsed?.txHash;
      } catch {
        /* ignore */
      }
    }

    return { ok: true, txHash, amount: humanAmount };
  }, [eoaConnected, eoaAddress, connector, resource, onProgress]);

  return { pay };
}
