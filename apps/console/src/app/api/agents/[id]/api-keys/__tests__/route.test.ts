/**
 * Tests for /api/agents/[id]/api-keys
 *
 * POST: auth, ownership, key creation, scope presets, scope validation, input validation.
 * GET: auth, ownership, metadata-only (never raw key/hash).
 * DELETE: auth, ownership, revoke, 404 on bad keyId.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  resolveSessionFromCookie: vi.fn(),
  getLinkedErc8004AgentsForController: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  supabaseSelect: vi.fn(),
}));

vi.mock('@/lib/auth/wallet-session', () => ({
  resolveSessionFromCookie: mocks.resolveSessionFromCookie,
  getLinkedErc8004AgentsForController: mocks.getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME: 'arclayer-wallet-session',
}));

vi.mock('@/lib/a2a/auth', () => ({
  createApiKey: mocks.createApiKey,
  revokeApiKey: mocks.revokeApiKey,
  API_KEY_SCOPES: {
    ERC8183_CREATE: 'erc8183:create',
    ERC8183_CONFIRM: 'erc8183:confirm',
    ERC8183_CLAIM: 'erc8183:claim',
    ERC8183_RUNNING: 'erc8183:running',
    ERC8183_SUBMIT: 'erc8183:submit',
    ERC8183_COMPLETE: 'erc8183:complete',
    ERC8183_TX: 'erc8183:tx',
  },
}));

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: mocks.supabaseSelect,
    }),
  }),
}));

// ── Import after mocks ────────────────────────────────────────────────────

import { POST, GET } from '../route';
import { DELETE } from '../[keyId]/route';
import { NextRequest } from 'next/server';

// ── Fixtures ──────────────────────────────────────────────────────────────

const AGENT_ID = '32179';
const WALLET = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20';
const MOCK_SESSION = {
  sessionId: 'sess_abc',
  wallet: WALLET.toLowerCase(),
  createdAt: Date.now(),
  expiresAt: Date.now() + 86400000,
};
const LINKED_AGENTS = [
  { agentId: AGENT_ID, tokenId: AGENT_ID, controller: WALLET.toLowerCase() },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function makePostRequest(body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = `arclayer-wallet-session=${cookie}`;
  return new NextRequest(`http://localhost/api/agents/${AGENT_ID}/api-keys`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeGetRequest(cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers['Cookie'] = `arclayer-wallet-session=${cookie}`;
  return new NextRequest(`http://localhost/api/agents/${AGENT_ID}/api-keys`, {
    method: 'GET',
    headers,
  });
}

function makeDeleteRequest(keyId: string, cookie?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (cookie) headers['Cookie'] = `arclayer-wallet-session=${cookie}`;
  return new NextRequest(`http://localhost/api/agents/${AGENT_ID}/api-keys/${keyId}`, {
    method: 'DELETE',
    headers,
  });
}

// ── POST Tests ────────────────────────────────────────────────────────────

describe('POST /api/agents/[id]/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSessionFromCookie.mockResolvedValue(MOCK_SESSION);
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue(LINKED_AGENTS);
    mocks.createApiKey.mockResolvedValue({
      ok: true,
      key: 'ak_test123456789',
      keyPrefix: 'ak_test12',
      id: 'key-uuid-001',
    });
  });

  it('creates key successfully (201)', async () => {
    const res = await POST(makePostRequest({ preset: 'provider' }, 'valid-token'), {
      params: Promise.resolve({ id: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(data.key).toBe('ak_test123456789');
    expect(data.keyPrefix).toBe('ak_test12');
    expect(data.id).toBe('key-uuid-001');
  });

  it('calls createApiKey with correct params', async () => {
    await POST(
      makePostRequest({ preset: 'provider', label: 'My Bot' }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );

    expect(mocks.createApiKey).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      label: 'My Bot',
      scopes: ['erc8183:claim', 'erc8183:running', 'erc8183:submit', 'erc8183:tx'],
      createdBy: WALLET.toLowerCase(),
    });
  });

  it('client preset resolves correct scopes', async () => {
    await POST(
      makePostRequest({ preset: 'client' }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );

    expect(mocks.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ['erc8183:create', 'erc8183:confirm', 'erc8183:tx'],
      }),
    );
  });

  it('evaluator preset resolves correct scopes', async () => {
    await POST(
      makePostRequest({ preset: 'evaluator' }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );

    expect(mocks.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ['erc8183:complete', 'erc8183:tx'],
      }),
    );
  });

  // ── Scope validation ──────────────────────────────────────────────────

  it('valid explicit scopes accepted', async () => {
    const res = await POST(
      makePostRequest({ scopes: ['erc8183:tx', 'erc8183:create'] }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(mocks.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['erc8183:tx', 'erc8183:create'] }),
    );
  });

  it('invalid explicit scope rejected (400)', async () => {
    const res = await POST(
      makePostRequest({ scopes: ['erc8183:tx', 'invalid:scope'] }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('invalid_scope');
    expect(data.detail).toContain('invalid:scope');
    expect(mocks.createApiKey).not.toHaveBeenCalled();
  });

  it('empty scopes array falls back to defaults', async () => {
    const res = await POST(
      makePostRequest({ scopes: [] }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );
    const data = await res.json();

    // Empty scopes = no explicit scopes → createApiKey gets defaults
    expect(res.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(mocks.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: undefined }),
    );
  });

  it('duplicate scopes deduped', async () => {
    const res = await POST(
      makePostRequest({ scopes: ['erc8183:tx', 'erc8183:tx', 'erc8183:create'] }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(mocks.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['erc8183:tx', 'erc8183:create'] }),
    );
  });

  // ── Input validation ──────────────────────────────────────────────────

  it('non-string label rejected (400)', async () => {
    const res = await POST(
      makePostRequest({ preset: 'provider', label: 123 }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('invalid_label');
  });

  it('label over 80 chars rejected (400)', async () => {
    const res = await POST(
      makePostRequest({ preset: 'provider', label: 'a'.repeat(81) }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('invalid_label');
  });

  it('label exactly 80 chars accepted', async () => {
    const res = await POST(
      makePostRequest({ preset: 'provider', label: 'a'.repeat(80) }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.ok).toBe(true);
  });

  it('invalid preset rejected (400)', async () => {
    const res = await POST(
      makePostRequest({ preset: 'admin' }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('invalid_preset');
  });

  it('non-array scopes rejected (400)', async () => {
    const res = await POST(
      makePostRequest({ scopes: 'erc8183:tx' }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('invalid_scopes');
  });

  it('non-string scope in array rejected (400)', async () => {
    const res = await POST(
      makePostRequest({ scopes: ['erc8183:tx', 123] }, 'valid-token'),
      { params: Promise.resolve({ id: AGENT_ID }) },
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('invalid_scope');
  });

  // ── Auth ──────────────────────────────────────────────────────────────

  it('missing auth returns 401', async () => {
    const res = await POST(makePostRequest({ preset: 'provider' }), {
      params: Promise.resolve({ id: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe('unauthorized');
  });

  it('invalid session returns 401', async () => {
    mocks.resolveSessionFromCookie.mockResolvedValue(null);
    const res = await POST(makePostRequest({ preset: 'provider' }, 'bad-token'), {
      params: Promise.resolve({ id: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe('invalid_session');
  });

  it('non-owner returns 403', async () => {
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
      { agentId: 'other-agent', tokenId: '999', controller: WALLET.toLowerCase() },
    ]);
    const res = await POST(makePostRequest({ preset: 'provider' }, 'valid-token'), {
      params: Promise.resolve({ id: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe('forbidden');
  });

  it('null body returns 400', async () => {
    const req = new NextRequest(`http://localhost/api/agents/${AGENT_ID}/api-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': 'arclayer-wallet-session=valid-token',
      },
      body: 'null',
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('invalid_body');
  });

  it('createApiKey failure returns 500', async () => {
    mocks.createApiKey.mockResolvedValue({ ok: false, error: 'db_error' });
    const res = await POST(makePostRequest({ preset: 'provider' }, 'valid-token'), {
      params: Promise.resolve({ id: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('create_failed');
  });
});

// ── GET Tests ─────────────────────────────────────────────────────────────

describe('GET /api/agents/[id]/api-keys', () => {
  const MOCK_ROWS = [
    {
      id: 'key-001',
      key_prefix: 'ak_abc1234',
      label: 'Worker Key',
      scopes: ['erc8183:claim', 'erc8183:tx'],
      created_at: '2026-06-01T00:00:00Z',
      last_used_at: '2026-06-02T12:00:00Z',
      revoked_at: null,
    },
    {
      id: 'key-002',
      key_prefix: 'ak_def5678',
      label: null,
      scopes: ['erc8183:create'],
      created_at: '2026-05-30T00:00:00Z',
      last_used_at: null,
      revoked_at: '2026-06-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSessionFromCookie.mockResolvedValue(MOCK_SESSION);
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue(LINKED_AGENTS);
    mocks.supabaseSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: MOCK_ROWS, error: null }),
      }),
    });
  });

  it('owner returns metadata list', async () => {
    const res = await GET(makeGetRequest('valid-token'), {
      params: Promise.resolve({ id: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.keys).toHaveLength(2);
    expect(data.keys[0].id).toBe('key-001');
    expect(data.keys[0].keyPrefix).toBe('ak_abc1234');
    expect(data.keys[0].label).toBe('Worker Key');
    expect(data.keys[0].status).toBe('active');
    expect(data.keys[1].status).toBe('revoked');
  });

  it('never returns raw key, key_hash, or hash fields', async () => {
    const res = await GET(makeGetRequest('valid-token'), {
      params: Promise.resolve({ id: AGENT_ID }),
    });
    const data = await res.json();
    const json = JSON.stringify(data);

    expect(json).not.toContain('key_hash');
    expect(json).not.toContain('keyHash');
    expect(json).not.toContain('"hash"');
    expect(json).not.toContain('"key":');
    expect(json).not.toContain('"rawKey"');

    // Each key object should only have allowed fields
    for (const key of data.keys) {
      expect(key).toHaveProperty('id');
      expect(key).toHaveProperty('keyPrefix');
      expect(key).toHaveProperty('label');
      expect(key).toHaveProperty('scopes');
      expect(key).toHaveProperty('createdAt');
      expect(key).toHaveProperty('lastUsedAt');
      expect(key).toHaveProperty('status');
      expect(key).not.toHaveProperty('key_hash');
      expect(key).not.toHaveProperty('key');
      expect(key).not.toHaveProperty('rawKey');
    }
  });

  it('non-owner returns 403', async () => {
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
      { agentId: 'other', tokenId: '999', controller: WALLET.toLowerCase() },
    ]);
    const res = await GET(makeGetRequest('valid-token'), {
      params: Promise.resolve({ id: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe('forbidden');
  });

  it('missing session returns 401', async () => {
    const res = await GET(makeGetRequest(), {
      params: Promise.resolve({ id: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe('unauthorized');
  });

  it('invalid session returns 401', async () => {
    mocks.resolveSessionFromCookie.mockResolvedValue(null);
    const res = await GET(makeGetRequest('bad-token'), {
      params: Promise.resolve({ id: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe('invalid_session');
  });
});

// ── DELETE Tests ──────────────────────────────────────────────────────────

describe('DELETE /api/agents/[id]/api-keys/[keyId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSessionFromCookie.mockResolvedValue(MOCK_SESSION);
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue(LINKED_AGENTS);
    mocks.revokeApiKey.mockResolvedValue(true);
  });

  it('owner revokes key (200)', async () => {
    const res = await DELETE(makeDeleteRequest('key-001', 'valid-token'), {
      params: Promise.resolve({ id: AGENT_ID, keyId: 'key-001' }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mocks.revokeApiKey).toHaveBeenCalledWith('key-001', AGENT_ID);
  });

  it('non-owner returns 403', async () => {
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
      { agentId: 'other', tokenId: '999', controller: WALLET.toLowerCase() },
    ]);
    const res = await DELETE(makeDeleteRequest('key-001', 'valid-token'), {
      params: Promise.resolve({ id: AGENT_ID, keyId: 'key-001' }),
    });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toBe('forbidden');
  });

  it('missing session returns 401', async () => {
    const res = await DELETE(makeDeleteRequest('key-001'), {
      params: Promise.resolve({ id: AGENT_ID, keyId: 'key-001' }),
    });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe('unauthorized');
  });

  it('invalid session returns 401', async () => {
    mocks.resolveSessionFromCookie.mockResolvedValue(null);
    const res = await DELETE(makeDeleteRequest('key-001', 'bad-token'), {
      params: Promise.resolve({ id: AGENT_ID, keyId: 'key-001' }),
    });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe('invalid_session');
  });

  it('wrong keyId returns 404', async () => {
    mocks.revokeApiKey.mockResolvedValue(false);
    const res = await DELETE(makeDeleteRequest('nonexistent-key', 'valid-token'), {
      params: Promise.resolve({ id: AGENT_ID, keyId: 'nonexistent-key' }),
    });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toBe('revoke_failed');
  });
});
