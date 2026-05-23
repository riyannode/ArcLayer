import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const readContract = vi.fn();
vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract })),
    http: vi.fn(() => ({})),
  };
});

import { GET } from './route';

describe('GET /api/x402/gateway-balance', () => {
  it('returns 400 for invalid address', async () => {
    const req = new NextRequest('http://localhost/api/x402/gateway-balance?address=bad');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns gateway deposit balances', async () => {
    readContract.mockResolvedValueOnce(1234567n);
    const req = new NextRequest('http://localhost/api/x402/gateway-balance?address=0x1111111111111111111111111111111111111111');
    const res = await GET(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      depositedUsdc: '1.234567',
      depositedAtomic: '1234567',
      method: 'gateway-wallet',
    });
  });
});
