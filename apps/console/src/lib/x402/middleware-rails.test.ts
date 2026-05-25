import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withGateway, withNative } from './middleware';

function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('x402 rail-locked wrappers', () => {
  it('withNative rejects Gateway payment', async () => {
    const handler = withNative(async () => NextResponse.json({ ok: true }), {
      amount: '1',
      resource: '/api/x402/protected-resource',
    });

    const req = new NextRequest('http://localhost/api/x402/protected-resource', {
      headers: {
        'payment-signature': encodeHeader({ scheme: 'exact', payload: {} }),
      },
    });

    const res = await handler(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('rail_not_allowed');
  });

  it('withGateway rejects Arc Native X-PAYMENT', async () => {
    const handler = withGateway(async () => NextResponse.json({ ok: true }), '$0.01', '/api/x402/protected-resource');

    const req = new NextRequest('http://localhost/api/x402/protected-resource', {
      headers: {
        'x-payment': encodeHeader({ scheme: 'exact', payload: {} }),
      },
    });

    const res = await handler(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('rail_not_allowed');
  });
});
