/**
 * x402 middleware rail classification tests.
 *
 * Proves PAYMENT-SIGNATURE header is classified correctly for
 * both Arc Native (eip3009) and Circle Gateway (gateway-batched-eip3009).
 */
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  testClassifyPaymentFromProof,
  testExtractPayment,
  withNative,
  type X402MiddlewareOptions,
} from './middleware';

// ─── Payload fixtures ─────────────────────────────────────────────────────────

const GATEWAY_PROOF = {
  accepted: {
    extra: {
      name: 'GatewayWalletBatched',
      transferMethod: 'gateway-batched-eip3009',
      version: '1',
    },
  },
  payload: {
    authorization: {
      from: '0x9fC73BE13EAB35DD55547f89b1aD2663b9038eE5',
      to: '0x4aA3402575b6D98EacE35A823EFa267F7365bdD2',
      value: '10000',
      validAfter: '0',
      validBefore: '9999999999',
      nonce: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    signature: '0x' + 'aa'.repeat(65),
  },
};

const NATIVE_PROOF = {
  accepted: {
    extra: {
      name: 'USDC',
      transferMethod: 'eip3009',
      version: '2',
      decimals: 6,
      symbol: 'USDC',
    },
  },
  payload: {
    authorization: {
      from: '0x9fC73BE13EAB35DD55547f89b1aD2663b9038eE5',
      to: '0x4aA3402575b6D98EacE35A823EFa267F7365bdD2',
      value: '10000',
      validAfter: '0',
      validBefore: '9999999999',
      nonce: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    signature: '0x' + 'bb'.repeat(65),
  },
};

const UNKNOWN_PROOF = {
  accepted: {
    extra: {
      name: 'UnrecognizedProtocol',
      transferMethod: 'some-unknown-method',
    },
  },
  payload: {
    authorization: {
      from: '0x9fC73BE13EAB35DD55547f89b1aD2663b9038eE5',
      to: '0x4aA3402575b6D98EacE35A823EFa267F7365bdD2',
      value: '10000',
      validAfter: '0',
      validBefore: '9999999999',
      nonce: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    },
    signature: '0x' + 'cc'.repeat(65),
  },
};

function mockReq(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function encodeProof(proof: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(proof)).toString('base64');
}

// ─── classifyPaymentFromProof ─────────────────────────────────────────────────

describe('classifyPaymentFromProof', () => {
  it('classifies gateway via transferMethod', () => {
    expect(testClassifyPaymentFromProof(GATEWAY_PROOF)).toBe('gateway');
  });

  it('classifies native via transferMethod', () => {
    expect(testClassifyPaymentFromProof(NATIVE_PROOF)).toBe('native');
  });

  it('classifies gateway via name (GatewayWalletBatched)', () => {
    expect(
      testClassifyPaymentFromProof({
        accepted: { extra: { name: 'GatewayWalletBatched' } },
      }),
    ).toBe('gateway');
  });

  it('classifies native via name (USDC)', () => {
    expect(
      testClassifyPaymentFromProof({
        accepted: { extra: { name: 'USDC' } },
      }),
    ).toBe('native');
  });

  it('returns null for unknown extra metadata', () => {
    expect(testClassifyPaymentFromProof(UNKNOWN_PROOF)).toBeNull();
  });

  it('returns null for missing extra', () => {
    expect(testClassifyPaymentFromProof({ accepted: {} })).toBeNull();
    expect(testClassifyPaymentFromProof({})).toBeNull();
  });
});

// ─── extractPayment ───────────────────────────────────────────────────────────

describe('extractPayment', () => {
  it('classifies gateway PAYMENT-SIGNATURE as gateway mode', () => {
    const req = mockReq({ 'payment-signature': encodeProof(GATEWAY_PROOF) });
    const result = testExtractPayment(req);
    expect(result).toEqual({ proof: GATEWAY_PROOF, mode: 'gateway' });
  });

  it('classifies native PAYMENT-SIGNATURE as native mode', () => {
    const req = mockReq({ 'payment-signature': encodeProof(NATIVE_PROOF) });
    const result = testExtractPayment(req);
    expect(result).toEqual({ proof: NATIVE_PROOF, mode: 'native' });
  });

  it('X-PAYMENT header always returns native (legacy)', () => {
    const req = mockReq({ 'x-payment': encodeProof(NATIVE_PROOF) });
    const result = testExtractPayment(req);
    expect(result?.mode).toBe('native');
  });

  it('unclassifiable with allowedRails=["arc-native-eoa"] falls through to native', () => {
    const req = mockReq({ 'payment-signature': encodeProof(UNKNOWN_PROOF) });
    const opts: X402MiddlewareOptions = {
      amount: '10000',
      resource: '/test',
      allowedRails: ['arc-native-eoa'],
    };
    const result = testExtractPayment(req, opts);
    expect(result).toEqual({ proof: UNKNOWN_PROOF, mode: 'native' });
  });

  it('unclassifiable with allowedRails=["circle-gateway-passkey"] falls through to gateway', () => {
    const req = mockReq({ 'payment-signature': encodeProof(UNKNOWN_PROOF) });
    const opts: X402MiddlewareOptions = {
      amount: '10000',
      resource: '/test',
      allowedRails: ['circle-gateway-passkey'],
    };
    const result = testExtractPayment(req, opts);
    expect(result).toEqual({ proof: UNKNOWN_PROOF, mode: 'gateway' });
  });

  it('unclassifiable with both rails allowed returns null (no silent routing)', () => {
    const req = mockReq({ 'payment-signature': encodeProof(UNKNOWN_PROOF) });
    const opts: X402MiddlewareOptions = {
      amount: '10000',
      resource: '/test',
      allowedRails: ['arc-native-eoa', 'circle-gateway-passkey'],
    };
    const result = testExtractPayment(req, opts);
    expect(result).toBeNull();
  });

  it('unclassifiable with no allowedRails returns null', () => {
    const req = mockReq({ 'payment-signature': encodeProof(UNKNOWN_PROOF) });
    const result = testExtractPayment(req);
    expect(result).toBeNull();
  });

  it('returns null when no payment header present', () => {
    const req = mockReq({});
    const result = testExtractPayment(req);
    expect(result).toBeNull();
  });
});

// ─── withNative integration ───────────────────────────────────────────────────

vi.mock('./gateway/batch-client', () => {
  return {
    getBatchFacilitatorClient: () => ({
      verify: async () => ({ isValid: true, payer: '0x9fC73BE13EAB35DD55547f89b1aD2663b9038eE5' }),
      settle: async () => ({ success: true }),
    }),
    getArcTestnetGatewayConfig: () => ({ gatewayWallet: '0x0077777d7eBA4688BDeF3E311b846F25870A19B9' }),
    isBatchPayment: () => false,
    isGatewayEnabled: () => false,
  };
});

vi.mock('./gateway/payment-store', () => {
  return {
    deriveGatewayPaymentId: () => 'mock-gw-payment-id',
    recordGatewayPayment: async () => undefined,
    consumeGatewayPayment: async () => ({ ok: true }),
    claimGatewaySettlement: async () => ({ acquired: true }),
  };
});

vi.mock('./exact/native-payment-store', () => {
  return {
    deriveNativePaymentId: () => 'mock-native-payment-id',
    consumeNativePayment: async () => ({ ok: true }),
    getNativePayment: async () => null,
    markNativeSettled: async () => undefined,
    markNativeFailed: async () => undefined,
    claimNativePayment: async () => ({ ok: true }),
  };
});

vi.mock('./exact/settle-exact', () => ({
  settleExactPayment: async () => ({ success: true, alreadySettled: false }),
}));

vi.mock('./exact/verify-exact', () => ({
  verifyExactEvmPayment: async () => ({ isValid: true }),
}));

vi.mock('./exact/verify-settlement-proof', () => ({
  verifyExactSettlementProof: async () => ({ isValid: true }),
}));

vi.mock('./access-session', () => {
  return {
    claimAccessSession: async () => ({ ok: true }),
    completeAccessSession: async () => undefined,
    releaseAccessSession: async () => undefined,
  };
});

vi.mock('./rail-session', () => {
  return {
    createRailSession: () => ({ sessionId: 'mock-rail-session' }),
    validateRailSession: () => ({ ok: true }),
    consumeRailSession: () => undefined,
  };
});

vi.mock('./resource-payment-store', () => {
  return {
    assertResourcePaymentStoreReady: async () => undefined,
    buildResourcePaymentKey: () => 'mock-resource-key',
    claimResourcePayment: async () => ({ kind: 'acquired' }),
    getResourcePayment: async () => null,
    markResourcePaymentSettled: async () => undefined,
    markResourcePaymentFailed: async () => undefined,
  };
});

vi.mock('@/lib/a2a/live-events', () => ({
  recordAgentLiveEvent: async () => undefined,
}));

describe('withNative integration', () => {
  beforeAll(() => {
    process.env.X402_RECEIVER_ADDRESS = '0x9fC73BE13EAB35DD55547f89b1aD2663b9038eE5';
  });

  it('withNative rejects a Gateway PAYMENT-SIGNATURE payload (rail_not_allowed)', async () => {
    const handler = async () => NextResponse.json({ ok: true }, { status: 200 });
    const wrapped = withNative(handler, {
      amount: '10000',
      resource: '/api/test',
      allowedRails: ['arc-native-eoa'],
    });

    const req = mockReq({ 'payment-signature': encodeProof(GATEWAY_PROOF) });
    const res = await wrapped(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('rail_not_allowed');
  });

  it('withNative accepts an Arc Native PAYMENT-SIGNATURE payload (no rail_not_allowed)', async () => {
    const handler = async () =>
      NextResponse.json({ ok: true, handled: true }, { status: 200 });
    const wrapped = withNative(handler, {
      amount: '10000',
      resource: '/api/test',
      allowedRails: ['arc-native-eoa'],
    });

    const req = mockReq({ 'payment-signature': encodeProof(NATIVE_PROOF) });
    const res = await wrapped(req);
    const body = await res.json();

    expect(body.error).not.toBe('rail_not_allowed');
    expect([200, 402, 403, 500]).toContain(res.status);
  });

  it('X-PAYMENT legacy native route still works with withNative', async () => {
    const handler = async () =>
      NextResponse.json({ ok: true, handled: true }, { status: 200 });
    const wrapped = withNative(handler, {
      amount: '10000',
      resource: '/api/test',
      allowedRails: ['arc-native-eoa'],
    });

    const req = mockReq({ 'x-payment': encodeProof(NATIVE_PROOF) });
    const res = await wrapped(req);
    const body = await res.json();

    expect(body.error).not.toBe('rail_not_allowed');
    expect(body.error).not.toBe('payment_required');
  });
});
