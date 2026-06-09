import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock('./supabaseClient', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import { resolveX402ServicePayoutAddress } from './service-payout';

function mockServiceProfile(row: Record<string, unknown> | null, error: { message: string } | null = null) {
  mockFrom.mockImplementation((table: string) => {
    expect(table).toBe('a2a_agent_commerce_profiles');
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: row, error }),
          }),
        }),
      }),
    };
  });
}

describe('resolveX402ServicePayoutAddress', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('resolves a service payout address for any current role metadata', async () => {
    mockServiceProfile({
      agent_id: 'pythia',
      pay_to: '0x1111111111111111111111111111111111111111',
      role: 'oracle',
      is_active: true,
    });

    await expect(resolveX402ServicePayoutAddress({ serviceAgentId: 'pythia' }))
      .resolves.toBe(getAddress('0x1111111111111111111111111111111111111111'));
  });

  it('does not require role === provider', async () => {
    mockServiceProfile({
      agent_id: 'evaluator-1',
      pay_to: '0x2222222222222222222222222222222222222222',
      role: 'evaluator',
      is_active: true,
    });

    await expect(resolveX402ServicePayoutAddress({ serviceOwnerAgentId: 'evaluator-1' }))
      .resolves.toBe(getAddress('0x2222222222222222222222222222222222222222'));
  });

  it('lets a fake future role receive nanopayments when it has a service payout address', async () => {
    mockServiceProfile({
      agent_id: 'future-agent',
      pay_to: '0x3333333333333333333333333333333333333333',
      role: 'custom-future-role',
      is_active: true,
    });

    await expect(resolveX402ServicePayoutAddress({ toolOwnerAgentId: 'future-agent' }))
      .resolves.toBe(getAddress('0x3333333333333333333333333333333333333333'));
  });

  it('throws service_agent_missing when no service owner can be resolved', async () => {
    await expect(resolveX402ServicePayoutAddress({}))
      .rejects.toMatchObject({ code: 'service_agent_missing' });
  });

  it('throws service_payout_address_missing when the service owner has no payout address', async () => {
    mockServiceProfile(null);

    await expect(resolveX402ServicePayoutAddress({ serviceAgentId: 'missing-profile' }))
      .rejects.toMatchObject({ code: 'service_payout_address_missing' });
  });

  it('throws service_payout_address_invalid for an invalid payout address', async () => {
    mockServiceProfile({
      agent_id: 'bad-payout',
      pay_to: 'not-an-address',
      role: 'oracle',
      is_active: true,
    });

    await expect(resolveX402ServicePayoutAddress({ resourceOwnerAgentId: 'bad-payout' }))
      .rejects.toMatchObject({ code: 'service_payout_address_invalid' });
  });
});
