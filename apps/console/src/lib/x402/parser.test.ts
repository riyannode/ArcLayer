import { describe, expect, it } from 'vitest';

import {
  canonicalResource,
  normalizeAddress,
  normalizeNetwork,
  normalizeScheme,
  normalizeTxHash,
  parsePaymentHeader,
  validatePaymentPayload,
  type X402PaymentPayload,
} from './parser';

const TX_HASH = `0x${'A'.repeat(64)}`;
const NORMALIZED_TX_HASH = TX_HASH.toLowerCase();
const PAYER = `0x${'B'.repeat(40)}`;
const NORMALIZED_PAYER = PAYER.toLowerCase();

function basePayload(overrides: Partial<X402PaymentPayload> = {}): X402PaymentPayload {
  return {
    scheme: 'arc-escrow',
    network: 'arc-testnet',
    chainId: 5042002,
    txHash: NORMALIZED_TX_HASH,
    ...overrides,
  };
}

describe('normalizeTxHash', () => {
  it('normalizes valid transaction hashes', () => {
    expect(normalizeTxHash(`  ${TX_HASH}  `)).toBe(NORMALIZED_TX_HASH);
  });

  it('rejects invalid transaction hashes', () => {
    expect(normalizeTxHash(`0x${'a'.repeat(63)}`)).toBeNull();
    expect(normalizeTxHash('not-a-hash')).toBeNull();
    expect(normalizeTxHash(null)).toBeNull();
  });
});

describe('normalizeAddress', () => {
  it('normalizes valid addresses', () => {
    expect(normalizeAddress(`  ${PAYER}  `)).toBe(NORMALIZED_PAYER);
  });

  it('rejects invalid addresses', () => {
    expect(normalizeAddress(`0x${'b'.repeat(39)}`)).toBeNull();
    expect(normalizeAddress('not-an-address')).toBeNull();
    expect(normalizeAddress(undefined)).toBeNull();
  });
});

describe('canonicalResource', () => {
  it('returns normalized paths without query strings or hashes', () => {
    expect(canonicalResource('https://example.com/jobs/123?x=1#section')).toBe('/jobs/123');
    expect(canonicalResource('jobs/123?x=1')).toBe('/jobs/123');
  });

  it('returns root for empty input', () => {
    expect(canonicalResource('   ')).toBe('/');
  });
});

describe('normalizeScheme', () => {
  it('maps supported scheme aliases to arc-escrow', () => {
    expect(normalizeScheme(' ARC-ESCROW ')).toBe('arc-escrow');
    expect(normalizeScheme('arclayer-escrow')).toBe('arc-escrow');
    expect(normalizeScheme('exact')).toBe('arc-escrow');
  });

  it('rejects unsupported schemes', () => {
    expect(normalizeScheme('unsupported')).toBeNull();
    expect(normalizeScheme(1)).toBeNull();
  });
});

describe('normalizeNetwork', () => {
  it('maps supported network aliases to arc-testnet', () => {
    expect(normalizeNetwork(' ARC-TESTNET ')).toBe('arc-testnet');
    expect(normalizeNetwork('eip155:5042002')).toBe('arc-testnet');
  });

  it('rejects unsupported networks', () => {
    expect(normalizeNetwork('mainnet')).toBeNull();
    expect(normalizeNetwork(false)).toBeNull();
  });
});

describe('parsePaymentHeader', () => {
  it('parses a raw transaction hash header', () => {
    expect(parsePaymentHeader(TX_HASH)).toEqual(basePayload());
  });

  it('parses JSON payloads and normalizes nested fields', () => {
    const payload = parsePaymentHeader(JSON.stringify({
      payment: {
        txHash: TX_HASH,
        payer: PAYER,
        resource: 'https://example.com/work/42?debug=true',
        scheme: 'exact',
        network: 'eip155:5042002',
      },
      chainId: '5042002',
      extra: { requirementId: 'req-1', jobId: 42 },
      metadata: { source: 'test' },
    }));

    expect(payload).toEqual(basePayload({
      payer: NORMALIZED_PAYER,
      resource: '/work/42',
      requirementId: 'req-1',
      jobId: '42',
      metadata: { source: 'test' },
    }));
  });

  it('parses base64url JSON payloads', () => {
    const encoded = Buffer.from(JSON.stringify({ txHash: TX_HASH })).toString('base64url');

    expect(parsePaymentHeader(encoded)).toEqual(basePayload());
  });

  it('returns null for missing, empty, malformed, or invalid payloads', () => {
    expect(parsePaymentHeader(null)).toBeNull();
    expect(parsePaymentHeader('   ')).toBeNull();
    expect(parsePaymentHeader('{bad json')).toBeNull();
    expect(parsePaymentHeader(JSON.stringify({ txHash: 'invalid' }))).toBeNull();
  });
});

describe('validatePaymentPayload', () => {
  it('accepts valid payloads and matching optional constraints', () => {
    const payment = basePayload({ resource: '/work/42', requirementId: 'req-1' });

    expect(validatePaymentPayload(payment, {
      resource: 'https://example.com/work/42?debug=true',
      requirementId: 'req-1',
    })).toEqual({ ok: true, payment });
  });

  it('returns specific errors for invalid payloads', () => {
    expect(validatePaymentPayload(null)).toEqual({
      ok: false,
      error: { code: 'INVALID_PAYMENT', message: 'Missing or invalid payment payload' },
    });
    expect(validatePaymentPayload(basePayload({ chainId: 1 }))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CHAIN' },
    });
    expect(validatePaymentPayload({ ...basePayload(), txHash: 'invalid' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_TX_HASH' },
    });
  });

  it('rejects resource and requirement mismatches', () => {
    expect(validatePaymentPayload(basePayload({ resource: '/work/42' }), { resource: '/work/43' })).toMatchObject({
      ok: false,
      error: { code: 'RESOURCE_MISMATCH' },
    });
    expect(validatePaymentPayload(basePayload({ requirementId: 'req-1' }), { requirementId: 'req-2' })).toMatchObject({
      ok: false,
      error: { code: 'REQUIREMENT_MISMATCH' },
    });
  });
});
