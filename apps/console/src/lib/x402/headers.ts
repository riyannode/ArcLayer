import type { X402Requirement, X402Payment } from './types';
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_NETWORK,
  JOB_ESCROW_ADDRESS,
  USDC_ADDRESS,
  X402_VERSION,
} from './constants';

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

export function encodePaymentHeader(value: unknown): string {
  return toBase64Url(JSON.stringify(value));
}

export function decodePaymentHeader<T>(value: string): T {
  return JSON.parse(fromBase64Url(value)) as T;
}

/**
 * Convert a facilitator requirement to a legacy-compatible accepts object.
 * Existing x402Client.ts expects: scheme 'exact', network 'eip155:5042002', maxAmountRequired.
 * New clients can read extra.requirementId/nonce/expiresAt/scheme.
 */
export function requirementToAccept(requirement: X402Requirement) {
  return {
    scheme: 'exact' as const,
    network: 'eip155:5042002' as const,
    chainId: ARC_TESTNET_CHAIN_ID,
    asset: requirement.asset,
    payTo: requirement.payTo,
    maxAmountRequired: requirement.amountRequired,
    resource: requirement.resource,
    description: requirement.description ?? 'Fund an ArcLayer escrow run with Arc testnet USDC, then retry with X-PAYMENT.',
    mimeType: requirement.mimeType ?? 'application/json',
    extra: {
      jobId: requirement.jobId,
      requirementId: requirement.requirementId,
      nonce: requirement.nonce,
      expiresAt: requirement.expiresAt,
      scheme: 'arc-escrow' as const,
    },
  };
}

/**
 * Build the full 402 body payload with backward-compatible accepts array.
 * Includes both 'arclayer-escrow' (legacy) and 'exact' (x402Client.ts) entries.
 */
export function buildPaymentRequiredPayload(requirement: X402Requirement) {
  const base = requirementToAccept(requirement);
  return {
    error: 'payment_required' as const,
    x402Version: X402_VERSION,
    accepts: [
      { ...base, scheme: 'arclayer-escrow' as const },
      base,
    ],
  };
}

export function buildPaymentRequiredHeader(payload: { x402Version: number; accepts: unknown[] }): string {
  return encodePaymentHeader(payload);
}

export function buildPaymentResponsePayload(
  payment: X402Payment,
  success = true
) {
  return {
    success,
    transaction: payment.txHash,
    network: 'eip155:5042002' as const,
    payer: payment.payer ?? '0x0000000000000000000000000000000000000000',
    amount: payment.amount,
    jobId: payment.jobId,
    resource: payment.resource,
    paymentId: payment.paymentId,
    requirementId: payment.requirementId,
    chainId: payment.chainId,
  };
}

export function buildPaymentResponseHeader(payload: {
  success: boolean;
  transaction: string;
  network: string;
  payer: string;
  amount: string;
  jobId: string;
  resource: string;
}): string {
  return encodePaymentHeader(payload);
}
