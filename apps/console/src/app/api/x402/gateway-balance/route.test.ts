import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock global fetch before importing the route
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import the route handler after mocking
const { GET } = await import('./route');

function makeReq(address: string | null) {
  const url = address
    ? `http://localhost/api/x402/gateway-balance?address=${address}`
    : 'http://localhost/api/x402/gateway-balance';
  return new NextRequest(url);
}

const VALID_ADDR = '0xa219F35b306bBa2272fA65f4bdC03cf22880cdf6';
const CHECKSUMMED = '0xa219F35b306bBa2272fA65f4bdC03cf22880cdf6';

describe('GET /api/x402/gateway-balance', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns 400 when address is missing', async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('address');
  });

  it('returns 400 when address is invalid', async () => {
    const res = await GET(makeReq('not-an-address'));
    expect(res.status).toBe(400);
  });

  it('returns 200 with balance on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balances: [
          { domain: 26, depositor: CHECKSUMMED, balance: '3.000000', pendingBatch: '0' },
        ],
      }),
    });

    const res = await GET(makeReq(VALID_ADDR));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.depositedUsdc).toBe('3.000000');
    expect(body.depositedAtomic).toBe('3000000');
    expect(body.method).toBe('gateway-api');

    // Verify fetch was called with correct args
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/balances');
    expect(opts.method).toBe('POST');
    const payload = JSON.parse(opts.body);
    expect(payload.token).toBe('USDC');
    expect(payload.sources[0].domain).toBe(26);
    expect(payload.sources[0].depositor).toBe(CHECKSUMMED);
  });

  it('returns 200 with zero balance when no entry found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ balances: [] }),
    });

    const res = await GET(makeReq(VALID_ADDR));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.depositedUsdc).toBe('0.000000');
    expect(body.depositedAtomic).toBe('0');
  });

  it('returns 502 when Gateway API returns non-OK', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'service unavailable' }),
    });

    const res = await GET(makeReq(VALID_ADDR));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.depositedUsdc).toBeNull();
    expect(body.error).toContain('503');
  });

  it('returns 502 when fetch throws (network failure)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await GET(makeReq(VALID_ADDR));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.depositedUsdc).toBeNull();
    expect(body.error).toBe('failed_to_query_gateway_api');
  });
});
