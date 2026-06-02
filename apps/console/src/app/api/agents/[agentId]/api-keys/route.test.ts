/**
 * Tests for POST /api/agents/[agentId]/api-keys
 *
 * Covers: auth, ownership, key creation, scope presets, error handling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  resolveSessionFromCookie: vi.fn(),
  getLinkedErc8004AgentsForController: vi.fn(),
  createApiKey: vi.fn(),
}));

vi.mock('@/lib/auth/wallet-session', () => ({
  resolveSessionFromCookie: mocks.resolveSessionFromCookie,
  getLinkedErc8004AgentsForController: mocks.getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME: 'arclayer-wallet-session',
}));

vi.mock('@/lib/a2a/auth', () => ({
  createApiKey: mocks.createApiKey,
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
  getSupabaseAdmin: () => ({ from: () => ({}) }),
}));

// ── Import after mocks ────────────────────────────────────────────────────

import { POST } from './route';
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

function makeRequest(body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = `arclayer-wallet-session=${cookie}`;
  return new NextRequest(`http://localhost/api/agents/${AGENT_ID}/api-keys`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/agents/[agentId]/api-keys', () => {
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
    const res = await POST(makeRequest({ preset: 'worker' }, 'valid-token'), {
      params: Promise.resolve({ agentId: AGENT_ID }),
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
      makeRequest({ preset: 'worker', label: 'My Bot' }, 'valid-token'),
      { params: Promise.resolve({ agentId: AGENT_ID }) },
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
      makeRequest({ preset: 'client' }, 'valid-token'),
      { params: Promise.resolve({ agentId: AGENT_ID }) },
    );

    expect(mocks.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ['erc8183:create', 'erc8183:confirm', 'erc8183:tx'],
      }),
    );
  });

  it('evaluator preset resolves correct scopes', async () => {
    await POST(
      makeRequest({ preset: 'evaluator' }, 'valid-token'),
      { params: Promise.resolve({ agentId: AGENT_ID }) },
    );

    expect(mocks.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ['erc8183:complete', 'erc8183:tx'],
      }),
    );
  });

  it('explicit scopes override preset', async () => {
    await POST(
      makeRequest({ scopes: ['erc8183:tx', 'erc8183:create'] }, 'valid-token'),
      { params: Promise.resolve({ agentId: AGENT_ID }) },
    );

    expect(mocks.createApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ['erc8183:tx', 'erc8183:create'],
      }),
    );
  });

  it('missing auth returns 401', async () => {
    const res = await POST(makeRequest({ preset: 'worker' }), {
      params: Promise.resolve({ agentId: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe('unauthorized');
  });

  it('invalid session returns 401', async () => {
    mocks.resolveSessionFromCookie.mockResolvedValue(null);
    const res = await POST(makeRequest({ preset: 'worker' }, 'bad-token'), {
      params: Promise.resolve({ agentId: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe('invalid_session');
  });

  it('non-owner returns 403', async () => {
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
      { agentId: 'other-agent', tokenId: '999', controller: WALLET.toLowerCase() },
    ]);
    const res = await POST(makeRequest({ preset: 'worker' }, 'valid-token'), {
      params: Promise.resolve({ agentId: AGENT_ID }),
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
      params: Promise.resolve({ agentId: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('invalid_body');
  });

  it('createApiKey failure returns 500', async () => {
    mocks.createApiKey.mockResolvedValue({ ok: false, error: 'db_error' });
    const res = await POST(makeRequest({ preset: 'worker' }, 'valid-token'), {
      params: Promise.resolve({ agentId: AGENT_ID }),
    });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('create_failed');
  });
});
