/**
 * Tests for GET /api/erc8183-jobs/[localJobId] — dual auth
 *
 * API key auth: preserves existing behavior (no change)
 * Wallet session auth:
 *   - 401 when no session
 *   - 404 when job not found
 *   - 403 when session wallet controls no participant agent
 *   - 200 + currentUserRole when wallet controls buyer/client agent
 *   - 200 + currentUserRole when wallet controls provider agent
 *   - 200 + currentUserRole when wallet controls evaluator agent
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  buildErc8183JobDetail: vi.fn(),
  getErc8183JobByLocalId: vi.fn(),
  resolveSessionFromCookie: vi.fn(),
  getLinkedErc8004AgentsForController: vi.fn(),
  escrowRail: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/a2a/auth', () => ({
  requireApiKey: mocks.requireApiKey,
  API_KEY_SCOPES: { ERC8183_CREATE: 'erc8183:create', ERC8183_TX: 'erc8183:tx' },
}));

vi.mock('@/lib/erc8183-jobs/read-model', () => ({
  buildErc8183JobDetail: mocks.buildErc8183JobDetail,
}));

vi.mock('@/lib/erc8183-jobs/store', () => ({
  getErc8183JobByLocalId: mocks.getErc8183JobByLocalId,
}));

vi.mock('@/lib/auth/wallet-session', () => ({
  resolveSessionFromCookie: mocks.resolveSessionFromCookie,
  getLinkedErc8004AgentsForController: mocks.getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME: 'arclayer-wallet-session',
}));

vi.mock('@/lib/rails/responses', () => ({
  escrowRail: mocks.escrowRail,
}));

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => ({ from: () => ({}) }),
}));

// ── Import after mocks ────────────────────────────────────────────────────

import { GET } from './route';
import { SESSION_COOKIE_NAME } from '@/lib/auth/wallet-session';

// ── Test fixtures ─────────────────────────────────────────────────────────

const LOCAL_JOB_ID = 'erc8183_test123';
const BUYER_AGENT = 'buyer-001';
const BUYER_CTRL = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20';
const PROVIDER_AGENT = 'provider-001';
const PROVIDER_CTRL = '0xb03141849F755b0a337b3352C2290fce66e0C6dD';
const EVALUATOR_AGENT = 'evaluator-001';
const EVALUATOR_CTRL = '0x0380542Fd05813461A71e9Befb80fBeA0AE656E8';
const CLAIMED_WORKER_AGENT = 'claimed-worker-001';
const CLAIMED_WORKER_CTRL = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
const UNRELATED_WALLET = '0x1111111111111111111111111111111111111111';

const MOCK_JOB_VIEW = {
  localJobId: LOCAL_JOB_ID,
  erc8183JobId: '42',
  settlementMode: 'erc8183_escrow' as const,
  erc8183Status: 'Funded' as const,
  status: 'claimed',
  buyerAgentId: BUYER_AGENT,
  clientAddress: BUYER_CTRL,
  providerAgentId: PROVIDER_AGENT,
  providerAddress: PROVIDER_CTRL,
  evaluatorAgentId: EVALUATOR_AGENT,
  evaluatorAddress: EVALUATOR_CTRL,
  workerId: PROVIDER_AGENT,
  priceAtomic: '2000000',
  description: 'Test job',
  expiredAtUnix: String(Math.floor(Date.now() / 1000) + 3600),
  hookAddress: '0x0000000000000000000000000000000000000000',
  inputPayload: {},
  inputPayloadHash: '0xinput',
  resultPayload: null,
  resultPayloadHash: null,
  proofPayload: null,
  proofPayloadHash: null,
  deliverableHash: null,
  reasonHash: null,
  createTxHash: '0xcreate',
  setBudgetTxHash: null,
  approveTxHash: null,
  fundTxHash: null,
  submitTxHash: null,
  completeTxHash: null,
  createdAt: new Date().toISOString(),
  claimedAt: null,
  startedAt: null,
};

const MOCK_DETAIL = {
  localJobId: LOCAL_JOB_ID,
  erc8183JobId: '42',
  settlementMode: 'erc8183_escrow' as const,
  lifecycleStatus: 'Funded' as const,
  localStatus: 'claimed',
  onchainStatus: 'Funded' as const,
  description: 'Test job',
  participants: {
    client: { agentId: BUYER_AGENT, address: BUYER_CTRL },
    provider: { agentId: PROVIDER_AGENT, address: PROVIDER_CTRL },
    evaluator: { agentId: EVALUATOR_AGENT, address: EVALUATOR_CTRL },
    worker: { agentId: PROVIDER_AGENT },
  },
  budget: { atomic: '2000000', decimals: 6, formatted: '2.000000' },
  expiry: { expiredAtUnix: MOCK_JOB_VIEW.expiredAtUnix, isExpired: false },
  payloads: {
    inputPayloadHash: '0xinput',
    resultPayloadHash: null,
    proofPayloadHash: null,
    deliverableHash: null,
    reasonHash: null,
  },
  txHashes: {
    createTxHash: '0xcreate',
    setBudgetTxHash: null,
    approveTxHash: null,
    fundTxHash: null,
    submitTxHash: null,
    completeTxHash: null,
  },
  timestamps: {
    createdAt: MOCK_JOB_VIEW.createdAt,
    claimedAt: null,
    startedAt: null,
    submittedAt: null,
    settledAt: null,
  },
  timeline: [],
  allowedActions: [],
};

// ── Mock job where workerId differs from providerAgentId (claimed by different agent) ──

const MOCK_JOB_VIEW_CLAIMED = {
  ...MOCK_JOB_VIEW,
  workerId: CLAIMED_WORKER_AGENT,
  status: 'claimed',
};

const MOCK_DETAIL_CLAIMED = {
  ...MOCK_DETAIL,
  participants: {
    ...MOCK_DETAIL.participants,
    worker: { agentId: CLAIMED_WORKER_AGENT },
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRequest(cookieValue?: string): NextRequest {
  const url = `http://localhost:3000/api/erc8183-jobs/${LOCAL_JOB_ID}`;
  const headers = new Headers();
  if (cookieValue) {
    headers.set('Cookie', `${SESSION_COOKIE_NAME}=${cookieValue}`);
  }
  return new NextRequest(url, { headers });
}

function mockContext(): { params: Promise<{ localJobId: string }> } {
  return { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/erc8183-jobs/[localJobId] — dual auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.escrowRail.mockReturnValue({ rail: 'escrow', settlementMode: 'erc8183_escrow' });
  });

  // ── API key auth (existing behavior preserved) ──────────────────────

  describe('API key auth', () => {
    it('returns job detail when API key is valid', async () => {
      mocks.requireApiKey.mockResolvedValue({ key: { agentId: 'bot-001' } });
      mocks.buildErc8183JobDetail.mockResolvedValue(MOCK_DETAIL);

      const res = await GET(makeRequest(), mockContext());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.job.localJobId).toBe(LOCAL_JOB_ID);
      // No currentUserRole for API key auth
      expect(body.currentUserRole).toBeUndefined();
    });

    it('returns 404 when API key valid but job not found', async () => {
      mocks.requireApiKey.mockResolvedValue({ key: { agentId: 'bot-001' } });
      mocks.buildErc8183JobDetail.mockResolvedValue(null);

      const res = await GET(makeRequest(), mockContext());
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe('not_found');
    });
  });

  // ── Wallet session auth ─────────────────────────────────────────────

  describe('wallet session auth', () => {
    it('returns 401 when no cookie and no API key', async () => {
      mocks.requireApiKey.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });

      const res = await GET(makeRequest(), mockContext());
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBe('unauthorized');
    });

    it('returns 401 when session is invalid/expired', async () => {
      mocks.requireApiKey.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });
      mocks.resolveSessionFromCookie.mockResolvedValue(null);

      const res = await GET(makeRequest('bad-token'), mockContext());
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error).toBe('unauthorized');
    });

    it('returns 404 when job not found via wallet session', async () => {
      mocks.requireApiKey.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });
      mocks.resolveSessionFromCookie.mockResolvedValue({
        sessionId: 'sess_1',
        wallet: BUYER_CTRL.toLowerCase(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
      mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
        { agentId: BUYER_AGENT, tokenId: BUYER_AGENT, controller: BUYER_CTRL.toLowerCase() },
      ]);
      mocks.getErc8183JobByLocalId.mockResolvedValue(null);

      const res = await GET(makeRequest('valid-token'), mockContext());
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe('not_found');
    });

    it('returns 403 when wallet controls no participant agent', async () => {
      mocks.requireApiKey.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });
      mocks.resolveSessionFromCookie.mockResolvedValue({
        sessionId: 'sess_unrelated',
        wallet: UNRELATED_WALLET.toLowerCase(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
      mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
        { agentId: 'unrelated-agent', tokenId: 'unrelated-agent', controller: UNRELATED_WALLET.toLowerCase() },
      ]);
      mocks.getErc8183JobByLocalId.mockResolvedValue(MOCK_JOB_VIEW);

      const res = await GET(makeRequest('unrelated-token'), mockContext());
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error).toBe('forbidden');
    });

    it('returns 200 + currentUserRole=client when wallet controls buyer agent', async () => {
      mocks.requireApiKey.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });
      mocks.resolveSessionFromCookie.mockResolvedValue({
        sessionId: 'sess_buyer',
        wallet: BUYER_CTRL.toLowerCase(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
      mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
        { agentId: BUYER_AGENT, tokenId: BUYER_AGENT, controller: BUYER_CTRL.toLowerCase() },
      ]);
      mocks.getErc8183JobByLocalId.mockResolvedValue(MOCK_JOB_VIEW);
      mocks.buildErc8183JobDetail.mockResolvedValue(MOCK_DETAIL);

      const res = await GET(makeRequest('buyer-token'), mockContext());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.job.localJobId).toBe(LOCAL_JOB_ID);
expect(body.currentUserRole).toBe('provider')
    });

    it('returns 200 + currentUserRole=provider when wallet controls provider agent', async () => {
      mocks.requireApiKey.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });
      mocks.resolveSessionFromCookie.mockResolvedValue({
        sessionId: 'sess_provider',
        wallet: PROVIDER_CTRL.toLowerCase(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
      mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
        { agentId: PROVIDER_AGENT, tokenId: PROVIDER_AGENT, controller: PROVIDER_CTRL.toLowerCase() },
      ]);
      mocks.getErc8183JobByLocalId.mockResolvedValue(MOCK_JOB_VIEW);
      mocks.buildErc8183JobDetail.mockResolvedValue(MOCK_DETAIL);

      const res = await GET(makeRequest('provider-token'), mockContext());
      const body = await res.json();

      expect(res.status).toBe(200);
expect(body.currentUserRole).toBe('provider')
    });

    it('returns 200 + currentUserRole=evaluator when wallet controls evaluator agent', async () => {
      mocks.requireApiKey.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });
      mocks.resolveSessionFromCookie.mockResolvedValue({
        sessionId: 'sess_evaluator',
        wallet: EVALUATOR_CTRL.toLowerCase(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
      mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
        { agentId: EVALUATOR_AGENT, tokenId: EVALUATOR_AGENT, controller: EVALUATOR_CTRL.toLowerCase() },
      ]);
      mocks.getErc8183JobByLocalId.mockResolvedValue(MOCK_JOB_VIEW);
      mocks.buildErc8183JobDetail.mockResolvedValue(MOCK_DETAIL);

      const res = await GET(makeRequest('evaluator-token'), mockContext());
      const body = await res.json();

      expect(res.status).toBe(200);
expect(body.currentUserRole).toBe('provider')
    });

    it('returns 200 + currentUserRole=provider when tokenId matches providerAgentId but agentId differs', async () => {
      mocks.requireApiKey.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });
      mocks.resolveSessionFromCookie.mockResolvedValue({
        sessionId: 'sess_tokenid',
        wallet: PROVIDER_CTRL.toLowerCase(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
      // tokenId matches PROVIDER_AGENT, but agentId is different
      mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
        { agentId: 'different-agent-id', tokenId: PROVIDER_AGENT, controller: PROVIDER_CTRL.toLowerCase() },
      ]);
      mocks.getErc8183JobByLocalId.mockResolvedValue(MOCK_JOB_VIEW);
      mocks.buildErc8183JobDetail.mockResolvedValue(MOCK_DETAIL);

      const res = await GET(makeRequest('tokenid-match'), mockContext());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
expect(body.currentUserRole).toBe('provider')
    });

    it('returns 200 + currentUserRole=provider when wallet controls claimed workerId (distinct from providerAgentId)', async () => {
      mocks.requireApiKey.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });
      mocks.resolveSessionFromCookie.mockResolvedValue({
        sessionId: 'sess_claimed_worker',
        wallet: CLAIMED_WORKER_CTRL.toLowerCase(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
      mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
        { agentId: CLAIMED_WORKER_AGENT, tokenId: CLAIMED_WORKER_AGENT, controller: CLAIMED_WORKER_CTRL.toLowerCase() },
      ]);
      // workerId = CLAIMED_WORKER_AGENT, providerAgentId = PROVIDER_AGENT (different)
      mocks.getErc8183JobByLocalId.mockResolvedValue(MOCK_JOB_VIEW_CLAIMED);
      mocks.buildErc8183JobDetail.mockResolvedValue(MOCK_DETAIL_CLAIMED);

      const res = await GET(makeRequest('claimed-worker-token'), mockContext());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
expect(body.currentUserRole).toBe('provider')
    });

    it('returns 200 + currentUserRole=provider when tokenId matches claimed workerId', async () => {
      mocks.requireApiKey.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });
      mocks.resolveSessionFromCookie.mockResolvedValue({
        sessionId: 'sess_claimed_worker_tokenid',
        wallet: CLAIMED_WORKER_CTRL.toLowerCase(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
      // tokenId matches CLAIMED_WORKER_AGENT, agentId is different
      mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
        { agentId: 'some-other-id', tokenId: CLAIMED_WORKER_AGENT, controller: CLAIMED_WORKER_CTRL.toLowerCase() },
      ]);
      mocks.getErc8183JobByLocalId.mockResolvedValue(MOCK_JOB_VIEW_CLAIMED);
      mocks.buildErc8183JobDetail.mockResolvedValue(MOCK_DETAIL_CLAIMED);

      const res = await GET(makeRequest('claimed-worker-tokenid'), mockContext());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
expect(body.currentUserRole).toBe('provider')
    });

    it('returns 403 when wallet has no relation to any participant including workerId', async () => {
      mocks.requireApiKey.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });
      mocks.resolveSessionFromCookie.mockResolvedValue({
        sessionId: 'sess_unrelated_claimed',
        wallet: UNRELATED_WALLET.toLowerCase(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
      mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
        { agentId: 'unrelated-agent', tokenId: 'unrelated-agent', controller: UNRELATED_WALLET.toLowerCase() },
      ]);
      // Job with distinct workerId — unrelated wallet should still get 403
      mocks.getErc8183JobByLocalId.mockResolvedValue(MOCK_JOB_VIEW_CLAIMED);

      const res = await GET(makeRequest('unrelated-claimed'), mockContext());
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error).toBe('forbidden');
    });

    it('uses expiredAt not deadline', async () => {
      mocks.requireApiKey.mockResolvedValue({ error: new Response('unauthorized', { status: 401 }) });
      mocks.resolveSessionFromCookie.mockResolvedValue({
        sessionId: 'sess_buyer',
        wallet: BUYER_CTRL.toLowerCase(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
      mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
        { agentId: BUYER_AGENT, tokenId: BUYER_AGENT, controller: BUYER_CTRL.toLowerCase() },
      ]);
      mocks.getErc8183JobByLocalId.mockResolvedValue(MOCK_JOB_VIEW);
      mocks.buildErc8183JobDetail.mockResolvedValue(MOCK_DETAIL);

      const res = await GET(makeRequest('buyer-token'), mockContext());
      const body = await res.json();

      expect(body.job.expiry.expiredAtUnix).toBeDefined();
      expect(body.job.deadline).toBeUndefined();
    });
  });
});
