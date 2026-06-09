import { beforeEach, describe, expect, it, vi } from 'vitest';

const railPreferences = new Map<string, string>();

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            if (table === 'user_rail_preferences' && column === 'wallet_address') {
              const rail = railPreferences.get(value.toLowerCase());
              return { data: rail ? { rail } : null, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
  }),
}));

const wallet = '0x1111111111111111111111111111111111111111';

function request(headers: Record<string, string> = {}, body?: Record<string, unknown>) {
  return new Request('http://localhost/api/x402/verify', {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('enforceRailHeader', () => {
  beforeEach(() => {
    railPreferences.clear();
  });

  it('allows legacy clients with no X-ARC-RAIL header', async () => {
    const { enforceRailHeader } = await import('./rail-enforce');
    await expect(enforceRailHeader(request())).resolves.toBeNull();
  });

  it('rejects invalid X-ARC-RAIL headers', async () => {
    const { enforceRailHeader } = await import('./rail-enforce');
    const response = await enforceRailHeader(request({ 'x-arc-rail': 'arc-escrow' }));

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: 'invalid_rail_header' });
  });

  it('rejects valid X-ARC-RAIL headers without a resolvable wallet', async () => {
    const { enforceRailHeader } = await import('./rail-enforce');
    const response = await enforceRailHeader(request({ 'x-arc-rail': 'native' }));

    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: 'missing_wallet_for_rail_enforcement' });
  });

  it('allows valid X-ARC-RAIL headers when wallet comes from X-ARC-WALLET', async () => {
    const { enforceRailHeader } = await import('./rail-enforce');
    const response = await enforceRailHeader(request({ 'x-arc-rail': 'native', 'x-arc-wallet': wallet }));

    expect(response).toBeNull();
  });

  it('allows valid X-ARC-RAIL headers when wallet comes from paymentPayload.payload.authorization.from', async () => {
    const { enforceRailHeader } = await import('./rail-enforce');
    const response = await enforceRailHeader(
      request({ 'x-arc-rail': 'native' }, { paymentPayload: { payload: { authorization: { from: wallet } } } }),
    );

    expect(response).toBeNull();
  });

  it('rejects a DB rail mismatch', async () => {
    railPreferences.set(wallet, 'gateway');
    const { enforceRailHeader } = await import('./rail-enforce');
    const response = await enforceRailHeader(request({ 'x-arc-rail': 'native', 'x-arc-wallet': wallet }));

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toMatchObject({ error: 'rail_mismatch', lockedRail: 'gateway' });
  });
});
