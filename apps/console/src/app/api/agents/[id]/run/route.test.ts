import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  withX402Mock: vi.fn((handler: (req: NextRequest) => Promise<Response>) => handler),
}));

vi.mock('@/lib/x402', () => ({ withX402: mocks.withX402Mock }));

import { POST } from './route';

describe('POST /api/agents/[id]/run', () => {
  it('returns 400 when agent id is invalid', async () => {
    const req = new NextRequest('http://localhost/api/agents/abc/run', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('configures withX402 and returns settled result for valid id', async () => {
    const req = new NextRequest('http://localhost/api/agents/42/run', { method: 'POST' });
    const res = await POST(req);
    const body = await res.json();

    expect(mocks.withX402Mock).toHaveBeenCalledTimes(1);
    expect(mocks.withX402Mock.mock.calls[0][1]).toMatchObject({
      amount: '1',
      resource: '/api/agents/42/run',
    });
    expect(body.ok).toBe(true);
    expect(body.agentId).toBe(42);
    expect(body.payment.status).toBe('settled');
  });
});
