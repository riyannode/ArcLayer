"use client";

import { useCallback, useState } from "react";
import { useAccount } from 'wagmi';
import { switchChain } from '@wagmi/core';
import { formatUnits, getAddress, type Hex } from 'viem';
import { config } from '@/lib/wagmi';

const ARC_CHAIN_ID = 5042002;
const USDC = getAddress('0x3600000000000000000000000000000000000000');

type Requirement = {
  scheme: 'exact';
  network: string;
  asset: `0x${string}`;
  amount: string;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
};

function randomNonce(): Hex {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex;
}

function b64(value: unknown) {
  return btoa(JSON.stringify(value));
}

export function useX402Pay(resource: string) {
  const [status, setStatus] = useState('idle');
  const { address, isConnected, connector } = useAccount();

  const pay = useCallback(async () => {
    if (!isConnected || !address || !connector) {
      setStatus('wallet not connected');
      return { ok: false };
    }

    await switchChain(config, { chainId: ARC_CHAIN_ID });

    setStatus('requesting challenge');
    const challengeRes = await fetch(`${resource}?rail=arc-native-eoa&payer=${address}`);
    const challenge = await challengeRes.json();
    const req = (challenge.accepts?.[0] ?? null) as Requirement | null;
    if (challengeRes.status !== 402 || !req) {
      setStatus('invalid challenge');
      return { ok: false };
    }

    setStatus(`signing ${formatUnits(BigInt(req.amount), 6)} USDC authorization`);
    const validBefore = String(Math.floor(Date.now() / 1000) + 600);
    const nonce = randomNonce();
    const provider = (await connector.getProvider()) as { request: (args: { method: string; params: unknown[] }) => Promise<unknown> };
    const signature = (await provider.request({
      method: 'eth_signTypedData_v4',
      params: [
        address,
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
          domain: { name: 'USDC', version: '2', chainId: ARC_CHAIN_ID, verifyingContract: USDC },
          message: {
            from: address,
            to: getAddress(req.payTo),
            value: `0x${BigInt(req.amount).toString(16)}`,
            validAfter: '0x0',
            validBefore: `0x${BigInt(validBefore).toString(16)}`,
            nonce,
          },
        }),
      ],
    })) as Hex;

    const paymentPayload = {
      x402Version: 2,
      accepted: req,
      payload: {
        signature,
        authorization: {
          from: address,
          to: getAddress(req.payTo),
          value: req.amount,
          validAfter: '0',
          validBefore,
          nonce,
        },
      },
    };

    setStatus('submitting payment');
    const settleRes = await fetch(resource, { headers: { 'X-PAYMENT': b64(paymentPayload) } });
    const settleJson = await settleRes.json();
    if (!settleRes.ok) {
      setStatus(`payment rejected (${settleRes.status})`);
      return { ok: false, data: settleJson };
    }

    setStatus(`unlocked: ${settleJson.txHash || 'ok'}`);
    return { ok: true, data: settleJson };
  }, [address, connector, isConnected, resource]);

  return { pay, status };
}
