import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./store.supabase', () => ({
  supabaseStore: { createRequirement: vi.fn() },
}));

import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_NETWORK, DEFAULT_REQUIREMENT_TTL_SECONDS, JOB_ESCROW_ADDRESS, USDC_ADDRESS } from './constants';
import { buildRequirement } from './requirements';

describe('buildRequirement', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('builds a canonical active x402 requirement with defaults', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const requirement = buildRequirement({
      resource: 'https://example.com/jobs/123?debug=true#section',
      amountRequired: '2500000',
    });

    expect(requirement).toMatchObject({
      protocol: 'x402',
      scheme: 'arc-escrow',
      network: ARC_TESTNET_NETWORK,
      chainId: ARC_TESTNET_CHAIN_ID,
      resource: '/jobs/123',
      resourceMethod: 'POST',
      payTo: JOB_ESCROW_ADDRESS,
      asset: USDC_ADDRESS,
      amountRequired: '2500000',
      amountDisplay: '2500000',
      currency: 'USDC',
      maxTimeoutSeconds: DEFAULT_REQUIREMENT_TTL_SECONDS,
      expiresAt: '2025-01-01T00:05:00.000Z',
      metadata: {},
      status: 'active',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    });
    expect(requirement.requirementId).toMatch(/^req_[a-f0-9]{32}$/);
    expect(requirement.nonce).toMatch(/^nonce_[a-f0-9]{32}$/);
  });

  it('preserves optional fields and explicit payment parameters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const metadata = { source: 'unit-test', attempts: 1 };
    const requirement = buildRequirement({
      resource: 'jobs/abc?ignored=true',
      resourceMethod: 'GET',
      agentId: 'agent-1',
      jobId: 'job-1',
      amountRequired: '1000000',
      payTo: '0x1111111111111111111111111111111111111111',
      asset: '0x2222222222222222222222222222222222222222',
      description: 'Fund job',
      mimeType: 'application/json',
      metadata,
      routePattern: '/jobs/:id',
      ttlSeconds: 42,
    });

    expect(requirement).toMatchObject({
      resource: '/jobs/abc',
      resourceMethod: 'GET',
      agentId: 'agent-1',
      jobId: 'job-1',
      payTo: '0x1111111111111111111111111111111111111111',
      asset: '0x2222222222222222222222222222222222222222',
      description: 'Fund job',
      mimeType: 'application/json',
      metadata,
      routePattern: '/jobs/:id',
      maxTimeoutSeconds: 42,
      expiresAt: '2025-01-01T00:00:42.000Z',
    });
  });

  it('uses environment overrides for default payTo and ttl', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    vi.stubEnv('X402_DEFAULT_PAY_TO', '0x3333333333333333333333333333333333333333');
    vi.stubEnv('X402_REQUIREMENT_TTL_SECONDS', '12');

    const requirement = buildRequirement({ resource: '/jobs/1', amountRequired: '1' });

    expect(requirement.payTo).toBe('0x3333333333333333333333333333333333333333');
    expect(requirement.maxTimeoutSeconds).toBe(12);
    expect(requirement.expiresAt).toBe('2025-01-01T00:00:12.000Z');
  });

  it('floors ttl values and enforces a one second minimum', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    const floored = buildRequirement({ resource: '/jobs/1', amountRequired: '1', ttlSeconds: 9.9 });
    const minimum = buildRequirement({ resource: '/jobs/1', amountRequired: '1', ttlSeconds: 0 });

    expect(floored.maxTimeoutSeconds).toBe(9);
    expect(floored.expiresAt).toBe('2025-01-01T00:00:09.000Z');
    expect(minimum.maxTimeoutSeconds).toBe(1);
    expect(minimum.expiresAt).toBe('2025-01-01T00:00:01.000Z');
  });
});
