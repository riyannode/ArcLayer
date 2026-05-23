import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';

describe('POST /api/agents/[id]/run', () => {
  beforeEach(() => {
    process.env.X402_RECEIVER_ADDRESS = '0x0000000000000000000000000000000000000001';
  });

  it('returns 402 challenge before payment', async () => {
    const req = new NextRequest('http://localhost/api/agents/1/run', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(402);
  });
});
