import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';

describe('POST /api/agents/[id]/run', () => {
  beforeEach(() => {
    process.env.X402_RECEIVER_ADDRESS = '0x0000000000000000000000000000000000000001';
  });

  it('returns 402 challenge before payment with dynamic resource URL', async () => {
    const req = new NextRequest('http://localhost/api/agents/1/run', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(402);

    const encoded = res.headers.get('PAYMENT-REQUIRED');
    expect(encoded).toBeTruthy();

    const decoded = JSON.parse(Buffer.from(encoded!, 'base64').toString('utf-8'));
    expect(decoded?.resource?.url).toBe('/api/agents/1/run');
  });
});
