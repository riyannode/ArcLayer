/**
 * Tests for POST /api/erc8183-jobs/web-hire/prepare
 *
 * Dual auth: API key (erc8183:create) OR wallet session cookie.
 * Covers: API key path, wallet session path, buyer ownership enforcement,
 * missing/invalid auth, identity resolution errors.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  resolveSessionFromCookie: vi.fn(),
  getLinkedErc8004AgentsForController: vi.fn(),
  validateWebHireInput: vi.fn(),
  resolveIdentityAndBuild: vi.fn(),
  createSupabaseIdentityResolver: vi.fn(),
  escrowRail: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/a2a/auth', () => ({
  requireApiKey: mocks.requireApiKey,
  API_KEY_SCOPES: { ERC8183_CREATE: 'erc8183:create' },
}));

vi.mock('@/lib/auth/wallet-session', () => ({
  resolveSessionFromCookie: mocks.resolveSessionFromCookie,
  getLinkedErc8004AgentsForController: mocks.getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME: 'arclayer-wallet-session',
}));

vi.mock('@/lib/erc8183-jobs/web-hire-contract', () => ({
  validateWebHireInput: mocks.validateWebHireInput,
  resolveIdentityAndBuild: mocks.resolveIdentityAndBuild,
  createSupabaseIdentityResolver: mocks.createSupabaseIdentityResolver,
}));

vi.mock('@/lib/rails/responses', () => ({
  escrowRail: mocks.escrowRail,
}));

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => ({ from: () => ({}) }),
}));

// ── Import after mocks ────────────────────────────────────────────────────

import { POST } from './route';
import { SESSION_COOKIE_NAME } from '@/lib/auth/wallet-session';

// ── Test fixtures ─────────────────────────────────────────────────────────

const BUYER_AGENT = 'buyer-001';
const BUYER_CTRL = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20';
const PROVIDER_AGENT = 'provider-001';
const PROVIDER_CTRL = '0xb03141849F755b0a337b3352C2290fce66e0C6dD';
const EVALUATOR_AGENT = 'evaluator-001';
const EVALUATOR_CTRL = '0x0380542Fd05813461A71e9Befb80fBeA0AE656E8';
const SESSION_WALLET = BUYER_CTRL;
const MOCK_SESSION = {
  sessionId: 'sess_abc123',
  wallet: SESSION_WALLET.toLowerCase() as `0x${string}`,
  createdAt: Date.now(),
  expiresAt: Date.now() + 86400000,
};
const LINKED_AGENTS = [
  { agentId: BUYER_AGENT, tokenId: BUYER_AGENT, controller: SESSION_WALLET.toLowerCase() },
];

const VALID_BODY = {
  settlementMode: 'erc8183_escrow',
  buyerAgentId: BUYER_AGENT,
  providerAgentId: PROVIDER_AGENT,
  evaluatorAgentId: EVALUATOR_AGENT,
  budgetAtomic: '2000000',
  expiredAtUnix: String(Math.floor(Date.now() / 1000) + 3600),
  description: 'Test hire',
  inputPayload: { task: 'analyze' },
};

const VALIDATED_INPUT = {
  ok: true as const,
  buyerAgentId: BUYER_AGENT,
  providerAgentId: PROVIDER_AGENT,
  evaluatorAgentId: EVALUATOR_AGENT,
  evaluatorMode: 'explicit' as const,
  budgetAtomic: '2000000',
  budget: BigInt(2000000),
  expiredAtUnix: VALID_BODY.expiredAtUnix,
  expiredAt: Number(VALID_BODY.expiredAtUnix),
  description: 'Test hire',
  hook: '0x0000000000000000000000000000000000000000',
  inputPayloadHash: 'abc123def456',
};

const SUCCESS_RESPONSE = {
  ok: true,
  settlementMode: 'erc8183_escrow',
  participants: {
    client: { agentId: BUYER_AGENT, controller: BUYER_CTRL },
    provider: { agentId: PROVIDER_AGENT, controller: PROVIDER_CTRL },
    evaluator: { agentId: EVALUATOR_AGENT, controller: EVALUATOR_CTRL, mode: 'explicit' },
  },
  budget: { atomic: '2000000', decimals: 6, formatted: '2.000000' },
  expiry: { expiredAtUnix: VALID_BODY.expiredAtUnix, isExpired: false },
  inputPayloadHash: 'abc123def456',
  description: 'Test hire',
  next: {
    createJob: {
      signer: 'client',
      provider: PROVIDER_CTRL,
      evaluator: EVALUATOR_CTRL,
      expiredAt: VALID_BODY.expiredAtUnix,
      description: 'Test hire',
      hook: '0x0000000000000000000000000000000000000000',
    },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server';

function makeRequest(body: unknown, cookieValue?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookieValue) {
    headers['Cookie'] = `${SESSION_COOKIE_NAME}=${cookieValue}`;
  }
  return new NextRequest('http://localhost/api/erc8183-jobs/web-hire/prepare', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/erc8183-jobs/web-hire/prepare', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: escrowRail returns rail envelope
    mocks.escrowRail.mockReturnValue({ rail: 'escrow', settlementMode: 'erc8183_escrow' });

    // Default: createSupabaseIdentityResolver returns a dummy resolver
    mocks.createSupabaseIdentityResolver.mockReturnValue(async () => null);

    // Default: validateWebHireInput returns valid
    mocks.validateWebHireInput.mockReturnValue(VALIDATED_INPUT);

    // Default: resolveIdentityAndBuild returns success
    mocks.resolveIdentityAndBuild.mockResolvedValue(SUCCESS_RESPONSE);
  });

  // ── API key auth path ─────────────────────────────────────────────────

  it('API key path still works (erc8183:create scope)', async () => {
    mocks.requireApiKey.mockResolvedValue({
      key: { id: 'key-1', agentId: 'api-agent', scopes: ['erc8183:create'] },
    });

    const res = await POST(makeRequest(VALID_BODY) as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mocks.requireApiKey).toHaveBeenCalled();
    // Wallet session should NOT be checked when API key succeeds
    expect(mocks.resolveSessionFromCookie).not.toHaveBeenCalled();
  });

  // ── Wallet session auth path ──────────────────────────────────────────

  it('wallet session path works with linked buyerAgentId', async () => {
    // API key fails (no header)
    mocks.requireApiKey.mockResolvedValue({
      error: { status: 401 },
    });
    // Wallet session succeeds
    mocks.resolveSessionFromCookie.mockResolvedValue(MOCK_SESSION);
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue(LINKED_AGENTS);

    const res = await POST(makeRequest(VALID_BODY, 'valid-token') as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mocks.resolveSessionFromCookie).toHaveBeenCalledWith('valid-token');
    expect(mocks.getLinkedErc8004AgentsForController).toHaveBeenCalledWith(
      SESSION_WALLET.toLowerCase(),
    );
  });

  it('wallet session works when buyerAgentId matches linked tokenId', async () => {
    mocks.requireApiKey.mockResolvedValue({ error: { status: 401 } });
    mocks.resolveSessionFromCookie.mockResolvedValue(MOCK_SESSION);
    // tokenId matches buyerAgentId
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
      { agentId: 'different-agent-id', tokenId: BUYER_AGENT, controller: SESSION_WALLET },
    ]);

    const res = await POST(makeRequest(VALID_BODY, 'valid-token') as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('wallet session works when buyerAgentId matches linked agentId', async () => {
    mocks.requireApiKey.mockResolvedValue({ error: { status: 401 } });
    mocks.resolveSessionFromCookie.mockResolvedValue(MOCK_SESSION);
    // agentId matches buyerAgentId (tokenId is different)
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
      { agentId: BUYER_AGENT, tokenId: '999', controller: SESSION_WALLET },
    ]);

    const res = await POST(makeRequest(VALID_BODY, 'valid-token') as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  // ── Wallet session rejects unlinked buyerAgentId ──────────────────────

  it('wallet session rejects unlinked buyerAgentId (403)', async () => {
    mocks.requireApiKey.mockResolvedValue({ error: { status: 401 } });
    mocks.resolveSessionFromCookie.mockResolvedValue(MOCK_SESSION);
    // buyerAgentId is NOT in linked agents
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
      { agentId: 'other-agent', tokenId: 'other-token', controller: SESSION_WALLET },
    ]);

    const res = await POST(makeRequest(VALID_BODY, 'valid-token') as any);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error).toBe('buyer_not_linked');
  });

  it('wallet session rejects when no linked agents (403)', async () => {
    mocks.requireApiKey.mockResolvedValue({ error: { status: 401 } });
    mocks.resolveSessionFromCookie.mockResolvedValue(MOCK_SESSION);
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue([]);

    const res = await POST(makeRequest(VALID_BODY, 'valid-token') as any);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error).toBe('no_linked_agents');
  });

  // ── Missing auth rejects ──────────────────────────────────────────────

  it('missing auth rejects (401) — no API key, no cookie', async () => {
    mocks.requireApiKey.mockResolvedValue({ error: { status: 401 } });
    // No cookie in request

    const res = await POST(makeRequest(VALID_BODY) as any);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(data.error).toBe('unauthorized');
  });

  // ── Invalid session rejects ───────────────────────────────────────────

  it('invalid session rejects (401)', async () => {
    mocks.requireApiKey.mockResolvedValue({ error: { status: 401 } });
    mocks.resolveSessionFromCookie.mockResolvedValue(null); // invalid/expired

    const res = await POST(makeRequest(VALID_BODY, 'bad-token') as any);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(data.error).toBe('invalid_session');
  });

  // ── Identity resolution errors ────────────────────────────────────────

  it('provider identity not found still rejects (422)', async () => {
    mocks.requireApiKey.mockResolvedValue({
      key: { id: 'key-1', agentId: 'api-agent', scopes: ['erc8183:create'] },
    });
    mocks.resolveIdentityAndBuild.mockResolvedValue({
      ok: false,
      error: 'provider_identity_not_found',
      detail: 'No identity found',
    });

    const res = await POST(makeRequest(VALID_BODY) as any);
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error).toBe('provider_identity_not_found');
  });

  it('evaluator identity not found still rejects (422)', async () => {
    mocks.requireApiKey.mockResolvedValue({
      key: { id: 'key-1', agentId: 'api-agent', scopes: ['erc8183:create'] },
    });
    mocks.resolveIdentityAndBuild.mockResolvedValue({
      ok: false,
      error: 'evaluator_identity_not_found',
      detail: 'No identity found',
    });

    const res = await POST(makeRequest(VALID_BODY) as any);
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error).toBe('evaluator_identity_not_found');
  });

  it('controller assertion mismatch rejects (422)', async () => {
    mocks.requireApiKey.mockResolvedValue({
      key: { id: 'key-1', agentId: 'api-agent', scopes: ['erc8183:create'] },
    });
    mocks.resolveIdentityAndBuild.mockResolvedValue({
      ok: false,
      error: 'buyer_controller_mismatch',
      detail: 'Controller assertion mismatch',
    });

    const res = await POST(makeRequest(VALID_BODY) as any);
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error).toBe('buyer_controller_mismatch');
  });

  // ── Field validation errors ───────────────────────────────────────────

  it('validation error returns 400', async () => {
    mocks.requireApiKey.mockResolvedValue({
      key: { id: 'key-1', agentId: 'api-agent', scopes: ['erc8183:create'] },
    });
    mocks.validateWebHireInput.mockReturnValue({
      ok: false,
      error: 'missing_buyerAgentId',
      detail: 'buyerAgentId is required',
    });

    const res = await POST(makeRequest({}) as any);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('missing_buyerAgentId');
  });

  // ── Wallet session missing buyerAgentId ───────────────────────────────

  it('wallet session rejects missing buyerAgentId (400)', async () => {
    mocks.requireApiKey.mockResolvedValue({ error: { status: 401 } });
    mocks.resolveSessionFromCookie.mockResolvedValue(MOCK_SESSION);
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue(LINKED_AGENTS);

    const bodyWithoutBuyer = { ...VALID_BODY, buyerAgentId: undefined };
    const res = await POST(makeRequest(bodyWithoutBuyer, 'valid-token') as any);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('missing_buyerAgentId');
  });

  // ── Unexpected error ──────────────────────────────────────────────────

  it('unexpected error returns 500', async () => {
    mocks.requireApiKey.mockRejectedValue(new Error('boom'));

    const res = await POST(makeRequest(VALID_BODY) as any);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('prepare_failed');
    expect(data.detail).toBe('boom');
  });
});
