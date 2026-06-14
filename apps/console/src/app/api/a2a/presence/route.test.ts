import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mocks (vi.hoisted makes them available during vi.mock hoisting) ─────────

const { mockRequireApiKey, mockUpsert, mockMaybeSingle } = vi.hoisted(() => ({
  mockRequireApiKey: vi.fn(),
  mockUpsert: vi.fn().mockResolvedValue({ ok: true }),
  mockMaybeSingle: vi.fn(),
}));

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      upsert: (...args: unknown[]) => mockUpsert(...args),
      select: () => ({
        eq: () => ({
          maybeSingle: (...args: unknown[]) => mockMaybeSingle(...args),
        }),
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
}));

vi.mock('@/lib/a2a/auth', () => ({
  requireApiKey: (...args: unknown[]) => mockRequireApiKey(...args),
}));

vi.mock('@/lib/a2a/live-events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/a2a/live-events')>();
  return {
    ...actual,
    upsertAgentPresence: (...args: unknown[]) => mockUpsert(...args),
    getAgentPresenceById: (...args: unknown[]) => mockMaybeSingle(...args),
  };
});

// ─── Import after mocks ──────────────────────────────────────────────────────

import { POST } from './route';
import { NextRequest } from 'next/server';

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/a2a/presence', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify(body),
  });
}

// ─── Presence POST — secret field rejection ──────────────────────────────────

describe('POST /api/a2a/presence — secret field rejection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ ok: true });
    mockRequireApiKey.mockResolvedValue({
      key: { agentId: '36192' },
    });
  });

  it('rejects body with privateKey at top level', async () => {
    const res = await POST(makePostRequest({ agentId: '123', privateKey: '0xabc' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('secret_fields_rejected');
  });

  it('rejects body with PRIVATE_KEY at top level', async () => {
    const res = await POST(makePostRequest({ agentId: '123', PRIVATE_KEY: '0xabc' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('secret_fields_rejected');
  });

  it('rejects body with providerPrivateKey (camelCase variant)', async () => {
    const res = await POST(makePostRequest({ agentId: '123', providerPrivateKey: '0xabc' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('secret_fields_rejected');
  });

  it('rejects body with accessToken', async () => {
    const res = await POST(makePostRequest({ agentId: '123', accessToken: 'tok_123' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('secret_fields_rejected');
  });

  it('rejects body with authToken', async () => {
    const res = await POST(makePostRequest({ agentId: '123', authToken: 'tok_123' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('secret_fields_rejected');
  });

  it('rejects body with key_hash', async () => {
    const res = await POST(makePostRequest({ agentId: '123', key_hash: 'abc123' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('secret_fields_rejected');
  });

  it('rejects body with nested secret field', async () => {
    const res = await POST(makePostRequest({
      agentId: '123',
      metadata: { apiKey: 'ak_123' },
    }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('secret_fields_rejected');
  });

  it('accepts normal heartbeat body', async () => {
    const res = await POST(makePostRequest({
      agentId: '36192',
      agentName: 'test-bot',
      status: 'online',
      role: 'provider',
      runtimeType: 'runner',
      processName: 'arclayer-runner',
      version: '0.1.0',
      chainId: 5042002,
      rpcOk: true,
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('accepts body with lastEventType and lastEventSummary', async () => {
    const res = await POST(makePostRequest({
      agentId: '36192',
      status: 'online',
      lastEventType: 'heartbeat',
      lastEventSummary: 'provider heartbeat',
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('accepts fields containing "key" substring (agentId, public_key_hash)', async () => {
    const res = await POST(makePostRequest({
      agentId: '36192',
      agentName: 'test-bot',
      status: 'online',
      // These contain "key" but are NOT secret fields
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });
});

// ─── Bot-health endpoint ─────────────────────────────────────────────────────

import { GET as BotHealthGET } from '../../agents/[id]/bot-health/route';

describe('GET /api/agents/[agentId]/bot-health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns offline when no presence found', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const req = new NextRequest('http://localhost/api/agents/99999/bot-health');
    const res = await BotHealthGET(req, { params: Promise.resolve({ id: '99999' }) });
    const json = await res.json();
    expect(json.status).toBe('offline');
    expect(json.ok).toBe(true);
  });

  it('returns unknown on read error', async () => {
    // getAgentPresenceById throws on DB errors
    mockMaybeSingle.mockRejectedValue(new Error('presence_read_failed: connection refused'));
    const req = new NextRequest('http://localhost/api/agents/123/bot-health');
    const res = await BotHealthGET(req, { params: Promise.resolve({ id: '123' }) });
    const json = await res.json();
    expect(json.status).toBe('unknown');
    expect(json.ok).toBe(false);
  });

  it('returns online when heartbeat is recent', async () => {
    const recentTime = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    // getAgentPresenceById returns the transformed shape
    mockMaybeSingle.mockResolvedValue({
      agentId: '36192',
      agentName: 'test-bot',
      status: 'online',
      lastHeartbeatAt: recentTime,
      lastEventType: 'heartbeat',
      lastEventSummary: 'heartbeat',
      updatedAt: recentTime,
      role: 'provider',
      runtimeType: 'runner',
      processName: 'arclayer-runner',
      version: '0.1.0',
      chainId: 5042002,
      rpcOk: true,
    });
    const req = new NextRequest('http://localhost/api/agents/36192/bot-health');
    const res = await BotHealthGET(req, { params: Promise.resolve({ id: '36192' }) });
    const json = await res.json();
    expect(json.status).toBe('online');
    expect(json.role).toBe('provider');
    expect(json.runtimeType).toBe('runner');
  });

  it('returns offline when heartbeat is stale (>5min)', async () => {
    const staleTime = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 min ago
    mockMaybeSingle.mockResolvedValue({
      agentId: '36192',
      agentName: null,
      status: 'online',
      lastHeartbeatAt: staleTime,
      lastEventType: null,
      lastEventSummary: null,
      updatedAt: staleTime,
      role: null,
      runtimeType: null,
      processName: null,
      version: null,
      chainId: null,
      rpcOk: null,
    });
    const req = new NextRequest('http://localhost/api/agents/36192/bot-health');
    const res = await BotHealthGET(req, { params: Promise.resolve({ id: '36192' }) });
    const json = await res.json();
    expect(json.status).toBe('offline');
  });
});
