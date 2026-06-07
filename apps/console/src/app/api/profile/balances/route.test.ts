import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock fetch globally (Gateway REST API)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock viem readContract (ERC-20 balanceOf)
const mockReadContract = vi.fn().mockResolvedValue(0n);
vi.mock('viem', async (importOriginal) => {
  const orig = await importOriginal<typeof import('viem')>();
  return {
    ...orig,
    createPublicClient: () => ({ readContract: mockReadContract }),
  };
});

const { GET } = await import('./route');

function makeReq(owner: string | null, agentAccount?: string) {
  const params = new URLSearchParams();
  if (owner) params.set('owner', owner);
  if (agentAccount) params.set('agentAccount', agentAccount);
  return new NextRequest(`http://localhost/api/profile/balances?${params}`);
}

const OWNER = '0x1111111111111111111111111111111111111111';
const AGENT = '0xa219F35b306bBa2272fA65f4bdC03cf22880cdf6';

describe('GET /api/profile/balances', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockReadContract.mockReset();
    mockReadContract.mockResolvedValue(0n);
  });

  it('returns 400 when owner is missing', async () => {
    const res = await GET(makeReq(null));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_owner');
  });

  it('returns 200 with owner USDC + gateway balance', async () => {
    mockReadContract.mockResolvedValueOnce(1_500_000n); // 1.5 USDC
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balances: [{ domain: 26, depositor: OWNER, balance: '2.000000', pendingBatch: '0' }],
      }),
    });

    const res = await GET(makeReq(OWNER));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // formatUnits(1500000n, 6) => '1.5' (no trailing zeros)
    expect(body.owner.usdc.formatted).toBe('1.5');
    // Gateway API returns raw string, passed through as-is
    expect(body.owner.gateway.formatted).toBe('2.000000');
    expect(body.agentAccount).toBeNull();
  });

  it('returns 200 with agent account balances when provided', async () => {
    // owner USDC + gateway
    mockReadContract.mockResolvedValueOnce(1_000_000n);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balances: [{ domain: 26, depositor: OWNER, balance: '1.000000' }],
      }),
    });
    // agent USDC + gateway
    mockReadContract.mockResolvedValueOnce(500_000n);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        balances: [{ domain: 26, depositor: AGENT, balance: '3.000000' }],
      }),
    });

    const res = await GET(makeReq(OWNER, AGENT));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owner.usdc.formatted).toBe('1');
    expect(body.owner.gateway.formatted).toBe('1.000000');
    expect(body.agentAccount.usdc.formatted).toBe('0.5');
    expect(body.agentAccount.gateway.formatted).toBe('3.000000');
  });

  it('handles Gateway API failure gracefully (null gateway)', async () => {
    mockReadContract.mockResolvedValueOnce(1_000_000n);
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });

    const res = await GET(makeReq(OWNER));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owner.usdc.formatted).toBe('1');
    expect(body.owner.gateway).toBeNull();
  });

  it('handles fetch network error gracefully (null gateway)', async () => {
    mockReadContract.mockResolvedValueOnce(1_000_000n);
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await GET(makeReq(OWNER));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owner.usdc.formatted).toBe('1');
    expect(body.owner.gateway).toBeNull();
  });

  it('returns zero gateway when no matching balance entry', async () => {
    mockReadContract.mockResolvedValueOnce(0n);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ balances: [] }),
    });

    const res = await GET(makeReq(OWNER));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owner.gateway.formatted).toBe('0.000000');
    expect(body.owner.gateway.raw).toBe('0');
  });
});
