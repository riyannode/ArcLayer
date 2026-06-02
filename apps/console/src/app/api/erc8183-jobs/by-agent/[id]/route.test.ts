/**
 * Tests for GET /api/erc8183-jobs/by-agent/[id]
 *
 * Visibility model:
 * - No session: returns ok with isOwner=false and asWorkerPublic only
 * - Unrelated session: returns ok with isOwner=false and asWorkerPublic only
 * - Owner session: returns isOwner=true and grouped asClient/asWorker/asEvaluator
 * - Public response does not include private fields/controllers/raw payloads
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  resolveSessionFromCookie: vi.fn(),
  getLinkedErc8004AgentsForController: vi.fn(),
  listErc8183Jobs: vi.fn(),
  normalizeErc8183LifecycleStatus: vi.fn(),
  getNextActionLabel: vi.fn(),
  escrowRail: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/auth/wallet-session', () => ({
  resolveSessionFromCookie: mocks.resolveSessionFromCookie,
  getLinkedErc8004AgentsForController: mocks.getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME: 'arclayer-wallet-session',
}));

vi.mock('@/lib/erc8183-jobs/store', () => ({
  listErc8183Jobs: mocks.listErc8183Jobs,
}));

vi.mock('@/lib/erc8183-jobs/read-model', () => ({
  normalizeErc8183LifecycleStatus: mocks.normalizeErc8183LifecycleStatus,
  getNextActionLabel: mocks.getNextActionLabel,
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

const AGENT_ID = 'worker-001';
const OWNER_WALLET = '0xb03141849F755b0a337b3352C2290fce66e0C6dD';
const OTHER_WALLET = '0x0380542Fd05813461A71e9Befb80fBeA0AE656E8';

const MOCK_WORKER_JOB = {
  localJobId: 'erc8183_abc123',
  erc8183JobId: '42',
  settlementMode: 'erc8183_escrow' as const,
  erc8183Status: 'Funded' as const,
  status: 'claimed',
  buyerAgentId: 'client-001',
  clientAddress: '0xaaaa',
  providerAgentId: AGENT_ID,
  providerAddress: OWNER_WALLET,
  evaluatorAgentId: 'evaluator-001',
  evaluatorAddress: '0xbbbb',
  workerId: AGENT_ID,
  priceAtomic: '2000000',
  description: 'Test job description for worker profile visibility',
  expiredAtUnix: String(Math.floor(Date.now() / 1000) + 3600),
  hookAddress: '0x0000000000000000000000000000000000000000',
  inputPayload: { task: 'analyze' },
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

const MOCK_CLIENT_JOB = {
  ...MOCK_WORKER_JOB,
  localJobId: 'erc8183_def456',
  buyerAgentId: AGENT_ID,
  providerAgentId: 'other-worker',
  evaluatorAgentId: 'evaluator-001',
  description: 'Job where this agent is the client',
};

const MOCK_EVALUATOR_JOB = {
  ...MOCK_WORKER_JOB,
  localJobId: 'erc8183_ghi789',
  buyerAgentId: 'client-001',
  providerAgentId: 'worker-002',
  evaluatorAgentId: AGENT_ID,
  description: 'Job where this agent is the evaluator',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRequest(cookieValue?: string): NextRequest {
  const url = `http://localhost:3000/api/erc8183-jobs/by-agent/${AGENT_ID}`;
  const headers = new Headers();
  if (cookieValue) {
    headers.set('Cookie', `${SESSION_COOKIE_NAME}=${cookieValue}`);
  }
  return new NextRequest(url, { headers });
}

function mockContext(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: AGENT_ID }) };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/erc8183-jobs/by-agent/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.escrowRail.mockReturnValue({ rail: 'escrow', settlementMode: 'erc8183_escrow' });
    mocks.normalizeErc8183LifecycleStatus.mockReturnValue('Funded');
    mocks.getNextActionLabel.mockReturnValue('Awaiting Worker');
  });

  it('returns ok with isOwner=false and asWorkerPublic only when no session', async () => {
    mocks.resolveSessionFromCookie.mockResolvedValue(null);
    mocks.listErc8183Jobs.mockResolvedValue([MOCK_WORKER_JOB]);

    const res = await GET(makeRequest(), mockContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.isOwner).toBe(false);
    expect(body.asWorkerPublic).toHaveLength(1);
    expect(body.asClient).toEqual([]);
    expect(body.asWorker).toEqual([]);
    expect(body.asEvaluator).toEqual([]);
  });

  it('does not expose private fields in public response', async () => {
    mocks.resolveSessionFromCookie.mockResolvedValue(null);
    mocks.listErc8183Jobs.mockResolvedValue([MOCK_WORKER_JOB]);

    const res = await GET(makeRequest(), mockContext());
    const body = await res.json();
    const pub = body.asWorkerPublic[0];

    // Safe fields present
    expect(pub.localJobId).toBe('erc8183_abc123');
    expect(pub.erc8183JobId).toBe('42');
    expect(pub.lifecycleStatus).toBe('Funded');
    expect(pub.inputPayloadHash).toBe('0xinput');
    expect(pub.createTxHash).toBe('0xcreate');

    // Private fields NOT present
    expect(pub.buyerAgentId).toBeUndefined();
    expect(pub.buyerController).toBeUndefined();
    expect(pub.providerController).toBeUndefined();
    expect(pub.evaluatorAgentId).toBeUndefined();
    expect(pub.evaluatorController).toBeUndefined();
    expect(pub.nextAction).toBeUndefined();
  });

  it('returns ok with isOwner=false when session wallet does not control this agent', async () => {
    mocks.resolveSessionFromCookie.mockResolvedValue({
      sessionId: 'sess_other',
      wallet: OTHER_WALLET.toLowerCase(),
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
    });
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
      { agentId: 'different-agent', tokenId: 'different-agent', controller: OTHER_WALLET.toLowerCase() },
    ]);
    mocks.listErc8183Jobs.mockResolvedValue([MOCK_WORKER_JOB]);

    const res = await GET(makeRequest('session-token'), mockContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isOwner).toBe(false);
    expect(body.asWorkerPublic).toHaveLength(1);
    expect(body.asClient).toEqual([]);
  });

  it('returns isOwner=true and grouped lists when session wallet controls this agent', async () => {
    mocks.resolveSessionFromCookie.mockResolvedValue({
      sessionId: 'sess_owner',
      wallet: OWNER_WALLET.toLowerCase(),
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
    });
    mocks.getLinkedErc8004AgentsForController.mockResolvedValue([
      { agentId: AGENT_ID, tokenId: AGENT_ID, controller: OWNER_WALLET.toLowerCase() },
    ]);
    // Three separate calls for asClient, asWorker, asEvaluator
    mocks.listErc8183Jobs
      .mockResolvedValueOnce([MOCK_CLIENT_JOB])    // asClient (buyerAgentId)
      .mockResolvedValueOnce([MOCK_WORKER_JOB])     // asWorker (providerAgentId)
      .mockResolvedValueOnce([MOCK_EVALUATOR_JOB]); // asEvaluator (evaluatorAgentId)

    const res = await GET(makeRequest('owner-token'), mockContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.isOwner).toBe(true);
    expect(body.asWorkerPublic).toEqual([]);
    expect(body.asClient).toHaveLength(1);
    expect(body.asWorker).toHaveLength(1);
    expect(body.asEvaluator).toHaveLength(1);

    // Private fields present for owner
    expect(body.asClient[0].buyerAgentId).toBe(AGENT_ID);
    expect(body.asClient[0].nextAction).toBe('Awaiting Worker');
  });

  it('returns empty arrays when no jobs exist', async () => {
    mocks.resolveSessionFromCookie.mockResolvedValue(null);
    mocks.listErc8183Jobs.mockResolvedValue([]);

    const res = await GET(makeRequest(), mockContext());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isOwner).toBe(false);
    expect(body.asWorkerPublic).toEqual([]);
  });

  it('uses expiredAt not deadline', async () => {
    mocks.resolveSessionFromCookie.mockResolvedValue(null);
    mocks.listErc8183Jobs.mockResolvedValue([MOCK_WORKER_JOB]);

    const res = await GET(makeRequest(), mockContext());
    const body = await res.json();
    const pub = body.asWorkerPublic[0];

    expect(pub.expiredAtUnix).toBeDefined();
    expect(pub.deadline).toBeUndefined();
  });

  it('truncates long descriptions to shortDescription', async () => {
    const longDesc = 'A'.repeat(150);
    mocks.resolveSessionFromCookie.mockResolvedValue(null);
    mocks.listErc8183Jobs.mockResolvedValue([
      { ...MOCK_WORKER_JOB, description: longDesc },
    ]);

    const res = await GET(makeRequest(), mockContext());
    const body = await res.json();
    const pub = body.asWorkerPublic[0];

    expect(pub.shortDescription).toHaveLength(100);
    expect(pub.shortDescription).toMatch(/\.\.\.$/);
  });
});
