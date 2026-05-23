import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract: mocks.readContract })),
    http: vi.fn(() => ({})),
  };
});

import { GET } from './route';

describe('GET /api/x402/gateway-balance', () => {
  it('returns 400 for invalid address', async () => {
    const req = new NextRequest('http://localhost/api/x402/gateway-balance?address=nope');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns formatted USDC and atomic amount on success', async () => {
    mocks.readContract.mockResolvedValueOnce(50000n);
    const req = new NextRequest('http://localhost/api/x402/gateway-balance?address=0x0000000000000000000000000000000000000000');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      depositedUsdc: '0.05',
      depositedAtomic: '50000',
      method: 'gateway-wallet',
    });
  });

  it('returns 502 on rpc failure with generic error', async () => {
    mocks.readContract.mockRejectedValueOnce(new Error('rpc exploded'));
    const req = new NextRequest('http://localhost/api/x402/gateway-balance?address=0x0000000000000000000000000000000000000000');
    const res = await GET(req);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ depositedUsdc: null, method: 'error', error: 'failed_to_read_gateway_balance' });
  });
});
