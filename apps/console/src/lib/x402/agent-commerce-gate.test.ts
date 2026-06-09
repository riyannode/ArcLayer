import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  serviceGate: null as null | Record<string, unknown>,
  sellerProfile: null as null | Record<string, unknown>,
  withX402Options: null as null | Record<string, unknown>,
}));

vi.mock('@/lib/a2a/auth', () => ({
  API_KEY_SCOPES: {
    AGENT_BRIDGE_WRITE: 'agent_bridge:write',
    AGENT_BRIDGE_RECEIPT: 'agent_bridge:receipt',
  },
  requireApiKey: vi.fn(async () => ({ key: { agentId: 'buyer-agent', scopes: ['agent_bridge:write'] } })),
}));

vi.mock('@/lib/agent-bridge/store', () => ({
  listBridgeEvents: vi.fn(async () => [{ id: 'event-1' }]),
  getBridgeReceiptByPayload: vi.fn(async () => null),
  insertBridgeReceipt: vi.fn(async () => undefined),
  stablePayloadHash: (payload: unknown) => `hash:${JSON.stringify(payload)}`,
}));

vi.mock('@/lib/a2a/service-gates', () => ({
  getActiveServiceGate: vi.fn(async () => mocks.serviceGate),
  normalizeOptionalAddress: vi.fn((value) => value),
}));

vi.mock('@/lib/a2a/commerce-profile', () => ({
  resolveSellerCommerceProfile: vi.fn(async () => mocks.sellerProfile ?? {
    agent_id: 'seller-agent',
    price_atomic: '1',
  }),
}));

vi.mock('@/lib/x402/service-payout', () => ({
  resolveX402ServicePayoutAddress: vi.fn(async () => '0x0000000000000000000000000000000000000001'),
}));

vi.mock('@/lib/x402/middleware', () => ({
  withX402: vi.fn((handler, options) => {
    mocks.withX402Options = options;
    return async (req: NextRequest) => handler(req);
  }),
}));

import { withPredictionMarketSellerCommerceGate } from './agent-commerce-gate';
import { normalizeAgentCommerceGateRequest } from './agent-commerce-policy';

function request(body: Record<string, unknown>) {
  return new NextRequest('https://example.test/api/x402/agent-commerce-gate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer ak_test' },
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    category: 'prediction-market-bots',
    buyerAgentId: 'buyer-agent',
    buyerRole: 'analyzer',
    sellerAgentId: 'seller-agent',
    sellerRole: 'oracle',
    scope: 'market_data',
    market: 'default',
    sessionId: 'session-1',
    accessType: 'oracle_data',
    ...overrides,
  };
}

describe('agent commerce service gate behavior', () => {
  beforeEach(() => {
    mocks.serviceGate = null;
    mocks.sellerProfile = { agent_id: 'seller-agent', price_atomic: '7' };
    mocks.withX402Options = null;
  });

  it('uses service gate price instead of legacy seller profile price', async () => {
    mocks.serviceGate = {
      id: 'gate-1',
      price_atomic: '2000',
      reputation_eligible: true,
      llm_receipt_required: false,
      pay_to: '0x0000000000000000000000000000000000000001',
    };

    const response = await withPredictionMarketSellerCommerceGate()(request(baseBody({ gateKey: 'oracle-data' })));
    const json = await response.json();

    expect(json.priceSource).toBe('service_gate');
    expect(json.serviceGateId).toBe('gate-1');
    expect(mocks.withX402Options?.amount).toBe('2000');
    expect(mocks.withX402Options?.payTo).toBe('0x0000000000000000000000000000000000000001');
  });

  it('allows an unknown sellerRole when a matching active service gate exists', async () => {
    mocks.serviceGate = {
      id: 'gate-custom',
      price_atomic: '10000',
      reputation_eligible: false,
      llm_receipt_required: false,
      pay_to: null,
    };

    const response = await withPredictionMarketSellerCommerceGate()(request(baseBody({
      sellerRole: 'custom-oracle',
      gateKey: 'premium',
    })));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.serviceRole).toBe('custom-oracle');
    expect(mocks.withX402Options?.amount).toBe('10000');
  });

  it('rejects unknown sellerRole when no service gate and no fallback policy match', async () => {
    const response = await withPredictionMarketSellerCommerceGate()(request(baseBody({ sellerRole: 'custom-oracle' })));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe('seller_role_not_allowed');
  });

  it('rejects buyer-supplied sellerPayTo', () => {
    const resolved = normalizeAgentCommerceGateRequest(baseBody({
      sellerPayTo: '0x0000000000000000000000000000000000000002',
    }));

    expect(resolved).toMatchObject({ ok: false, status: 400, error: 'seller_pay_to_not_allowed' });
  });

  it('preserves legacy seller profile fallback', async () => {
    mocks.sellerProfile = { agent_id: 'seller-agent', price_atomic: '7' };

    const response = await withPredictionMarketSellerCommerceGate()(request(baseBody()));
    const json = await response.json();

    expect(json.priceSource).toBe('seller_profile');
    expect(mocks.withX402Options?.amount).toBe('7');
  });
});
