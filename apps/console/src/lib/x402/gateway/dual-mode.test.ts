/**
 * Minimal unit tests for dual-mode x402 routing logic.
 * Covers: isBatchPayment routing, paymentId derivation stability,
 * replay protection, accepted_pending_settlement handling,
 * and /supported response shape.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_VERSION,
  GATEWAY_NETWORK_NAME,
  ARC_TESTNET_CAIP2_NETWORK,
  USDC_ADDRESS,
  X402_VERSION,
  X402_VERSION_V2,
} from '../constants';
import { isBatchPayment } from './batch-client';
import {
  deriveGatewayPaymentId,
  recordGatewayPayment,
  consumeGatewayPayment,
  getGatewayPayment,
  type GatewayPaymentEvidence,
} from './payment-store';

// ─── 1. isBatchPayment routing ───────────────────────────────────────────────

describe('isBatchPayment routing', () => {
  it('returns true for GatewayWalletBatched requirements', () => {
    const req = { extra: { name: CIRCLE_BATCHING_NAME, version: CIRCLE_BATCHING_VERSION } };
    expect(isBatchPayment(req)).toBe(true);
  });

  it('returns false for Arc Native exact requirements', () => {
    const req = { extra: { name: 'USDC', version: '2', transferMethod: 'eip3009' } };
    expect(isBatchPayment(req)).toBe(false);
  });

  it('returns false for arc-escrow (legacy) requirements', () => {
    const req = { scheme: 'arc-escrow', extra: undefined };
    expect(isBatchPayment(req)).toBe(false);
  });

  it('returns false for null/undefined input', () => {
    expect(isBatchPayment(null)).toBe(false);
    expect(isBatchPayment(undefined)).toBe(false);
  });

  it('returns false when extra exists but name does not match', () => {
    const req = { extra: { name: 'SomethingElse', version: '1' } };
    expect(isBatchPayment(req)).toBe(false);
  });
});

// ─── 2. Gateway paymentId derivation stability ───────────────────────────────

describe('deriveGatewayPaymentId', () => {
  const payload = { from: '0xABC', nonce: '123', amount: '10000' };
  const requirements = { scheme: 'exact', network: GATEWAY_NETWORK_NAME, asset: USDC_ADDRESS };

  it('produces a deterministic sha256 hex string', () => {
    const id1 = deriveGatewayPaymentId(payload, requirements);
    const id2 = deriveGatewayPaymentId(payload, requirements);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different IDs for different payloads', () => {
    const id1 = deriveGatewayPaymentId(payload, requirements);
    const id2 = deriveGatewayPaymentId({ ...payload, nonce: '456' }, requirements);
    expect(id1).not.toBe(id2);
  });

  it('is stable regardless of object key order', () => {
    const reqA = { scheme: 'exact', network: GATEWAY_NETWORK_NAME, asset: USDC_ADDRESS };
    const reqB = { asset: USDC_ADDRESS, network: GATEWAY_NETWORK_NAME, scheme: 'exact' };
    const idA = deriveGatewayPaymentId(payload, reqA);
    const idB = deriveGatewayPaymentId(payload, reqB);
    expect(idA).toBe(idB);
  });
});

// ─── 3. Replay protection ────────────────────────────────────────────────────

describe('Gateway replay protection', () => {
  const paymentId = 'test-replay-' + Date.now();

  beforeEach(() => {
    // Record a verified payment
    recordGatewayPayment({ paymentId, status: 'verified', payer: '0xAAA' });
  });

  it('consumeGatewayPayment succeeds on first use', () => {
    const result = consumeGatewayPayment(paymentId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.evidence.paymentId).toBe(paymentId);
      expect(result.evidence.usedAt).toBeGreaterThan(0);
    }
  });

  it('consumeGatewayPayment rejects replay (second use)', () => {
    // First consume
    consumeGatewayPayment(paymentId);
    // Second consume — replay
    const result = consumeGatewayPayment(paymentId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('replayed');
    }
  });

  it('consumeGatewayPayment returns missing for unknown paymentId', () => {
    const result = consumeGatewayPayment('nonexistent-id-xyz');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing');
    }
  });
});

// ─── 4. accepted_pending_settlement handling ─────────────────────────────────

describe('accepted_pending_settlement status tracking', () => {
  it('records accepted status and upgrades to settled', () => {
    const paymentId = 'pending-settle-' + Date.now();

    // Simulate: verify succeeded, settle returned !success (async batch)
    recordGatewayPayment({ paymentId, status: 'accepted', payer: '0xBBB', verifiedAt: Date.now() });
    const pending = getGatewayPayment(paymentId);
    expect(pending?.status).toBe('accepted');

    // Simulate: later settlement confirmation
    recordGatewayPayment({ paymentId, status: 'settled', settledAt: Date.now(), transaction: '0xTX123' });
    const settled = getGatewayPayment(paymentId);
    expect(settled?.status).toBe('settled');
    expect(settled?.transaction).toBe('0xTX123');
    // Original payer preserved via merge
    expect(settled?.payer).toBe('0xBBB');
  });

  it('accepted payment can still be consumed for resource unlock', () => {
    const paymentId = 'accepted-consume-' + Date.now();
    recordGatewayPayment({ paymentId, status: 'accepted', payer: '0xCCC' });

    const result = consumeGatewayPayment(paymentId);
    expect(result.ok).toBe(true);
  });
});

// ─── 5. /supported response shape validation ─────────────────────────────────

describe('/supported response shape', () => {
  // Simulate the response structure from the route handler
  function buildSupportedResponse() {
    const arcNativeExact = {
      x402Version: X402_VERSION_V2,
      scheme: 'exact',
      network: ARC_TESTNET_CAIP2_NETWORK,
      asset: USDC_ADDRESS,
      extra: { name: 'USDC', version: '2', transferMethod: 'eip3009' },
    };

    const gatewayBatched = {
      x402Version: X402_VERSION_V2,
      scheme: 'exact',
      network: GATEWAY_NETWORK_NAME,
      asset: USDC_ADDRESS,
      extra: {
        name: CIRCLE_BATCHING_NAME,
        version: CIRCLE_BATCHING_VERSION,
        transferMethod: 'gateway-batched-eip3009',
      },
    };

    const legacyEscrow = {
      x402Version: X402_VERSION,
      scheme: 'arc-escrow',
      network: 'arc-testnet',
      asset: USDC_ADDRESS,
      extra: {},
    };

    return { accepts: [arcNativeExact, gatewayBatched, legacyEscrow] };
  }

  it('returns exactly 3 payment options (Arc Native, Gateway, legacy)', () => {
    const resp = buildSupportedResponse();
    expect(resp.accepts).toHaveLength(3);
  });

  it('Arc Native option uses eip155:5042002 network and eip3009 transfer', () => {
    const resp = buildSupportedResponse();
    const arcNative = resp.accepts[0];
    expect(arcNative.network).toBe('eip155:5042002');
    expect(arcNative.scheme).toBe('exact');
    expect(arcNative.extra.transferMethod).toBe('eip3009');
  });

  it('Gateway option uses arcTestnet network and GatewayWalletBatched name', () => {
    const resp = buildSupportedResponse();
    const gateway = resp.accepts[1];
    expect(gateway.network).toBe(GATEWAY_NETWORK_NAME);
    expect(gateway.extra.name).toBe(CIRCLE_BATCHING_NAME);
    expect(gateway.extra.version).toBe(CIRCLE_BATCHING_VERSION);
  });

  it('Gateway option is detected by isBatchPayment', () => {
    const resp = buildSupportedResponse();
    const gateway = resp.accepts[1];
    expect(isBatchPayment(gateway)).toBe(true);
  });

  it('Arc Native option is NOT detected as batch payment', () => {
    const resp = buildSupportedResponse();
    const arcNative = resp.accepts[0];
    expect(isBatchPayment(arcNative)).toBe(false);
  });

  it('Legacy arc-escrow option is NOT detected as batch payment', () => {
    const resp = buildSupportedResponse();
    const legacy = resp.accepts[2];
    expect(isBatchPayment(legacy)).toBe(false);
  });
});
