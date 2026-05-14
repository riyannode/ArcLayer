/**
 * x402 client — Buyer/Client-side fetch wrapper.
 *
 * Flow:
 *   1. POST /api/agents/:id/run without payment
 *   2. Server returns 402 Payment Required with `accepts[]` descriptor
 *   3. Wallet signs & submits JobEscrow-funding tx (testnet USDC)
 *   4. We retry the POST with a structured `X-PAYMENT` payload
 *   5. Server verifies receipt on-chain, returns job result
 *
 * This file is network-only — it assumes wagmi config is loaded and an
 * active wallet client is available. The caller owns wallet state.
 */

import { encodeFunctionData, type Address, type Hash } from 'viem';
import type { Config } from 'wagmi';
import { sendTransaction, waitForTransactionReceipt } from 'wagmi/actions';
import { CONTRACTS, JOB_ESCROW_ABI, USDC_ABI, arcTestnet } from '@arclayer/sdk';

export interface X402Accept {
  scheme: 'exact' | 'arc-escrow' | 'arclayer-escrow';
  network: string;
  chainId: number;
  asset: Address;
  payTo: Address;
  maxAmountRequired: string; // bigint-as-string, base units
  resource: string;
  requirementId?: string;
  jobId?: string;
  description?: string;
  mimeType?: string;
}

export interface X402PaymentRequired {
  error: 'payment_required';
  x402Version: 1;
  accepts: X402Accept[];
}

export interface X402RunOk<T = unknown> {
  ok: true;
  agentId: string;
  jobId: number | null;
  payment: { chainId: number; txHash: Hash };
  result: T;
}

export class X402Error extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
    this.name = 'X402Error';
  }
}

/**
 * Submit a JobEscrow-funding payment for an x402 `accepts` descriptor.
 * Approves USDC (if needed) and calls `fundJob(jobId, amount)`.
 *
 * Returns the settlement tx hash to pass back in `X-PAYMENT`.
 */
async function settlePayment(
  wagmiConfig: Config,
  accept: X402Accept,
  jobId: bigint
): Promise<Hash> {
  if (accept.chainId !== arcTestnet.id) {
    throw new X402Error(400, accept, `Unsupported chainId ${accept.chainId}; expected ${arcTestnet.id}.`);
  }

  const amount = BigInt(accept.maxAmountRequired);

  // 1. Approve USDC spend to JobEscrow (idempotent — user may have prior allowance).
  const approveHash = await sendTransaction(wagmiConfig, {
    to: accept.asset,
    data: encodeFunctionData({
      abi: USDC_ABI,
      functionName: 'approve',
      args: [accept.payTo, amount],
    }),
  });
  await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });

  // 2. Fund the escrow row for this jobId.
  const fundHash = await sendTransaction(wagmiConfig, {
    to: accept.payTo,
    data: encodeFunctionData({
      abi: JOB_ESCROW_ABI,
      functionName: 'fund',
      args: [jobId, amount],
    }),
  });
  await waitForTransactionReceipt(wagmiConfig, { hash: fundHash });

  return fundHash;
}

function buildPaymentHeader(accept: X402Accept, txHash: Hash, jobId: bigint): string {
  return JSON.stringify({
    scheme: accept.scheme,
    network: accept.network,
    chainId: accept.chainId,
    txHash,
    requirementId: accept.requirementId,
    resource: accept.resource,
    jobId: accept.jobId ?? jobId.toString(),
  });
}

/**
 * Run an agent with automatic x402 payment handling.
 *
 * @example
 *   const res = await runAgent(wagmiConfig, agentId, {
 *     jobId: 42n,
 *     input: { prompt: 'summarize this doc' },
 *   });
 */
export async function runAgent<T = unknown>(
  wagmiConfig: Config,
  agentId: string | number,
  body: { jobId: bigint; input?: unknown; prompt?: string }
): Promise<X402RunOk<T>> {
  const url = `/api/agents/${agentId}/run`;

  const serialize = (b: typeof body) => JSON.stringify({
    ...b,
    jobId: b.jobId.toString(),
  });

  // 1. First attempt — no payment header.
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: serialize(body),
  });

  // 2. If 402, settle payment then retry once.
  if (res.status === 402) {
    const challenge = (await res.json()) as X402PaymentRequired;
    const accept = challenge.accepts?.[0];
    if (!accept) {
      throw new X402Error(402, challenge, 'Server returned 402 without accepts descriptor.');
    }

    const txHash = await settlePayment(wagmiConfig, accept, body.jobId);

    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': buildPaymentHeader(accept, txHash, body.jobId),
      },
      body: serialize(body),
    });
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new X402Error(res.status, errBody, `Agent run failed: ${res.status}`);
  }

  return (await res.json()) as X402RunOk<T>;
}
