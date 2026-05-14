import { describe, expect, it } from 'vitest';

import {
  buildPaymentRequiredHeader,
  buildPaymentRequiredPayload,
  buildPaymentResponseHeader,
  buildPaymentResponsePayload,
  decodePaymentHeader,
  encodePaymentHeader,
  requirementToAccept,
} from './headers';
import { ARC_TESTNET_CHAIN_ID, X402_VERSION } from './constants';
import type { X402Payment, X402Requirement } from './types';

function requirement(overrides: Partial<X402Requirement> = {}): X402Requirement {
  return {
    requirementId: 'req-1',
    protocol: 'x402',
    scheme: 'arc-escrow',
    network: 'arc-testnet',
    chainId: ARC_TESTNET_CHAIN_ID,
    resource: '/jobs/1',
    resourceMethod: 'POST',
    description: 'Fund job 1',
    mimeType: 'application/json',
    payTo: '0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225',
    asset: '0x3600000000000000000000000000000000000000',
    amountRequired: '2500000',
    amountDisplay: '2.50',
    currency: 'USDC',
    maxTimeoutSeconds: 300,
    expiresAt: '2025-01-01T00:05:00.000Z',
    nonce: 'nonce-1',
    jobId: 'job-1',
    metadata: { source: 'test' },
    status: 'active',
    ...overrides,
  };
}

function payment(overrides: Partial<X402Payment> = {}): X402Payment {
  return {
    paymentId: 'pay-1',
    requirementId: 'req-1',
    txHash: `0x${'a'.repeat(64)}`,
    chainId: ARC_TESTNET_CHAIN_ID,
    scheme: 'arc-escrow',
    network: 'arc-testnet',
    payer: '0x1111111111111111111111111111111111111111',
    payTo: '0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225',
    asset: '0x3600000000000000000000000000000000000000',
    amount: '2500000',
    jobId: 'job-1',
    resource: '/jobs/1',
    eventName: 'JobFunded',
    verificationPayload: {},
    settlementPayload: {},
    status: 'verified',
    ...overrides,
  };
}

describe('payment header encoding', () => {
  it('round-trips JSON values as base64url without padding', () => {
    const value = { success: true, transaction: `0x${'a'.repeat(64)}` };
    const encoded = encodePaymentHeader(value);

    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    expect(decodePaymentHeader<typeof value>(encoded)).toEqual(value);
  });
});

describe('requirementToAccept', () => {
  it('builds legacy-compatible exact accept objects with x402 metadata', () => {
    expect(requirementToAccept(requirement())).toEqual({
      scheme: 'exact',
      network: 'eip155:5042002',
      chainId: ARC_TESTNET_CHAIN_ID,
      asset: '0x3600000000000000000000000000000000000000',
      payTo: '0xF0E1B0709A012AdE0b73596fDC8FA0CE037Dd225',
      maxAmountRequired: '2500000',
      resource: '/jobs/1',
      description: 'Fund job 1',
      mimeType: 'application/json',
      extra: {
        jobId: 'job-1',
        requirementId: 'req-1',
        nonce: 'nonce-1',
        expiresAt: '2025-01-01T00:05:00.000Z',
        scheme: 'arc-escrow',
      },
    });
  });

  it('uses default description and mime type when optional fields are omitted', () => {
    const accept = requirementToAccept(requirement({ description: undefined, mimeType: undefined }));

    expect(accept.description).toBe('Fund an ArcLayer escrow run with Arc testnet USDC, then retry with X-PAYMENT.');
    expect(accept.mimeType).toBe('application/json');
  });
});

describe('buildPaymentRequiredPayload', () => {
  it('builds a 402 payload with legacy and exact accept entries', () => {
    const payload = buildPaymentRequiredPayload(requirement());

    expect(payload.error).toBe('payment_required');
    expect(payload.x402Version).toBe(X402_VERSION);
    expect(payload.accepts).toHaveLength(2);
    expect(payload.accepts[0]).toMatchObject({ scheme: 'arclayer-escrow', network: 'eip155:5042002' });
    expect(payload.accepts[1]).toMatchObject({ scheme: 'exact', network: 'eip155:5042002' });
    expect(payload.accepts[0]).toMatchObject({ extra: { requirementId: 'req-1', nonce: 'nonce-1' } });
  });

  it('encodes payment-required headers that decode to the original payload', () => {
    const payload = buildPaymentRequiredPayload(requirement());

    expect(decodePaymentHeader(buildPaymentRequiredHeader(payload))).toEqual(payload);
  });
});

describe('buildPaymentResponsePayload', () => {
  it('builds successful payment response payloads from payments', () => {
    expect(buildPaymentResponsePayload(payment())).toEqual({
      success: true,
      transaction: `0x${'a'.repeat(64)}`,
      network: 'eip155:5042002',
      payer: '0x1111111111111111111111111111111111111111',
      amount: '2500000',
      jobId: 'job-1',
      resource: '/jobs/1',
      paymentId: 'pay-1',
      requirementId: 'req-1',
      chainId: ARC_TESTNET_CHAIN_ID,
    });
  });

  it('supports failed responses and default payer values', () => {
    const payload = buildPaymentResponsePayload(payment({ payer: undefined }), false);

    expect(payload.success).toBe(false);
    expect(payload.payer).toBe('0x0000000000000000000000000000000000000000');
  });

  it('encodes payment-response headers that decode to the original payload', () => {
    const payload = buildPaymentResponsePayload(payment());

    expect(decodePaymentHeader(buildPaymentResponseHeader(payload))).toEqual(payload);
  });
});
