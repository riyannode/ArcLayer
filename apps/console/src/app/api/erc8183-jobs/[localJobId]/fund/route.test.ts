/**
 * Tests for ERC-8183 fund route — setBudget guard.
 *
 * Verifies:
 * - rejects when setBudgetTxHash is missing (409 budget_not_set)
 * - rejects when priceAtomic is missing or zero (409 budget_zero)
 * - rejects when fundTxHash already exists (409 already_funded)
 * - rejects when local status is claimed/running/submitted/completed/settled (409 job_not_fundable_status)
 * - rejects when job is expired (409 job_expired)
 * - rejects when on-chain budget is 0 (409 budget_not_set)
 * - rejects when on-chain status is not Open (409 job_not_fundable_status)
 * - rejects when on-chain read fails (503 rpc_unavailable)
 * - returns approve/fund tx instructions when all guards pass
 * - preserves auth/ownership behavior
 * - logs warning on budget mismatch (non-blocking)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  getErc8183JobByLocalId: vi.fn(),
  assertErc8183Participant: vi.fn(),
  readOnchainJob: vi.fn(),
  escrowRail: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/a2a/auth', () => ({
  requireApiKey: mocks.requireApiKey,
  API_KEY_SCOPES: { ERC8183_CONFIRM: 'erc8183:confirm' },
}));

vi.mock('@/lib/erc8183-jobs/store', () => ({
  getErc8183JobByLocalId: mocks.getErc8183JobByLocalId,
}));

vi.mock('@/lib/erc8183-jobs/authz', () => ({
  assertErc8183Participant: mocks.assertErc8183Participant,
}));

vi.mock('@/lib/erc8183-jobs/receipt', () => ({
  readOnchainJob: mocks.readOnchainJob,
}));

vi.mock('@/lib/rails/responses', () => ({
  escrowRail: mocks.escrowRail,
}));

vi.mock('@arclayer/sdk', () => ({
  ARC_TOKENS: { USDC: '0x3600000000000000000000000000000000000000' },
  CONTRACTS: { ERC8183_AGENTIC_COMMERCE: '0x0747000000000000000000000000000000000000' },
}));

vi.mock('@/lib/contracts/erc8183', () => ({
  ERC8183JobStatus: { Open: 0, Funded: 1, Submitted: 2, Completed: 3, Rejected: 4, Expired: 5 },
}));

// ── Import after mocks ────────────────────────────────────────────────────

import { POST } from './route';

// ── Test fixtures ─────────────────────────────────────────────────────────

const LOCAL_JOB_ID = 'erc8183_fund_test';
const BUYER_AGENT = 'buyer-agent-001';
const PROVIDER_AGENT = 'provider-agent-001';
const FAR_FUTURE_UNIX = '1800000000'; // year ~2027

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    localJobId: LOCAL_JOB_ID,
    erc8183JobId: '42',
    settlementMode: 'erc8183_escrow',
    erc8183Status: 'Open',
    status: 'created',
    buyerAgentId: BUYER_AGENT,
    clientAddress: '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20',
    providerAgentId: PROVIDER_AGENT,
    providerAddress: '0xb03141849F755b0a337b3352C2290fce66e0C6dD',
    evaluatorAgentId: 'evaluator-agent-001',
    evaluatorAddress: '0x0380542Fd05813461A71e9Befb80fBeA0AE656E8',
    workerId: null,
    priceAtomic: '2000000',
    description: 'Test job',
    expiredAtUnix: FAR_FUTURE_UNIX,
    hookAddress: '0x0000000000000000000000000000000000000000',
    inputPayload: {},
    inputPayloadHash: 'aabb',
    resultPayload: null,
    resultPayloadHash: null,
    proofPayload: null,
    proofPayloadHash: null,
    deliverableHash: null,
    reasonHash: null,
    createTxHash: '0x1111',
    setBudgetTxHash: '0x2222',
    approveTxHash: null,
    fundTxHash: null,
    submitTxHash: null,
    completeTxHash: null,
    createdAt: '2026-01-01T00:00:00Z',
    claimedAt: null,
    startedAt: null,
    ...overrides,
  };
}

function makeOnchainJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 42n,
    client: '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20' as `0x${string}`,
    provider: '0xb03141849F755b0a337b3352C2290fce66e0C6dD' as `0x${string}`,
    evaluator: '0x0380542Fd05813461A71e9Befb80fBeA0AE656E8' as `0x${string}`,
    description: 'Test job',
    budget: 2000000n,
    expiredAt: 1800000000n,
    status: 0, // Open
    hook: '0x0000000000000000000000000000000000000000' as `0x${string}`,
    erc8183Status: 'Open' as const,
    ...overrides,
  };
}

function makeRequest() {
  return new NextRequest(`http://localhost/api/erc8183-jobs/${LOCAL_JOB_ID}/fund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ak_test' },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/erc8183-jobs/[localJobId]/fund — setBudget guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: auth passes
    mocks.requireApiKey.mockResolvedValue({ agentId: BUYER_AGENT, error: null });
    mocks.assertErc8183Participant.mockReturnValue(null); // no error = authorized
    mocks.escrowRail.mockReturnValue({ rail: 'escrow', settlementMode: 'erc8183_escrow' });

    // Default: valid job with setBudget confirmed
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob());

    // Default: on-chain job is Open with budget set
    mocks.readOnchainJob.mockResolvedValue(makeOnchainJob());
  });

  // ── Existing guards still work ──────────────────────────────────────────

  it('returns 404 when job not found', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('job_not_found');
    expect(body.txs).toBeUndefined();
  });

  it('returns 400 when erc8183JobId is missing', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ erc8183JobId: null }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('create_job_pending');
    expect(body.txs).toBeUndefined();
  });

  it('preserves auth/ownership behavior', async () => {
    mocks.requireApiKey.mockResolvedValue({ agentId: null, error: new Response('unauthorized', { status: 401 }) });

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });

    // requireApiKey returns an error response, which gets returned directly
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller is not the buyer', async () => {
    mocks.assertErc8183Participant.mockReturnValue(
      new Response(JSON.stringify({ ok: false, error: 'forbidden' }), { status: 403 }),
    );

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });

    expect(res.status).toBe(403);
  });

  // ── Local guards ────────────────────────────────────────────────────────

  it('rejects when setBudgetTxHash is missing (409 budget_not_set)', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ setBudgetTxHash: null }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('budget_not_set');
    expect(body.message).toMatch(/Provider must set budget/);
    expect(body.txs).toBeUndefined();
  });

  it('rejects when priceAtomic is missing (409 budget_zero)', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ priceAtomic: null }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('budget_zero');
    expect(body.txs).toBeUndefined();
  });

  it('rejects when priceAtomic is zero (409 budget_zero)', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ priceAtomic: '0' }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('budget_zero');
    expect(body.txs).toBeUndefined();
  });

  it('rejects when priceAtomic is negative (409 budget_zero)', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ priceAtomic: '-100' }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('budget_zero');
    expect(body.txs).toBeUndefined();
  });

  it('rejects when fundTxHash already exists (409 already_funded)', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ fundTxHash: '0xexisting' }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('already_funded');
    expect(body.txs).toBeUndefined();
  });

  it.each(['claimed', 'running', 'submitted', 'completed', 'settled'])(
    'rejects when local status is %s (409 job_not_fundable_status)',
    async (status) => {
      mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ status }));

      const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.ok).toBe(false);
      expect(body.error).toBe('job_not_fundable_status');
      expect(body.message).toMatch(status);
      expect(body.txs).toBeUndefined();
    },
  );

  it('rejects when job is expired (409 job_expired)', async () => {
    // expiredAtUnix in the past (year 2020)
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ expiredAtUnix: '1577836800' }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('job_expired');
    expect(body.txs).toBeUndefined();
  });

  it('does NOT treat null expiredAtUnix as expired', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ expiredAtUnix: null }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    // Should pass expiry check and proceed (may succeed or fail on other guards)
    expect(body.error).not.toBe('job_expired');
  });

  it('does NOT treat expiredAtUnix "0" as expired', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ expiredAtUnix: '0' }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body.error).not.toBe('job_expired');
  });

  // ── On-chain guards ─────────────────────────────────────────────────────

  it('rejects when on-chain read fails (503 rpc_unavailable)', async () => {
    mocks.readOnchainJob.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('rpc_unavailable');
    expect(body.txs).toBeUndefined();
  });

  it('rejects when on-chain budget is 0 (409 budget_not_set)', async () => {
    mocks.readOnchainJob.mockResolvedValue(makeOnchainJob({ budget: 0n }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('budget_not_set');
    expect(body.message).toMatch(/On-chain budget is zero/);
    expect(body.txs).toBeUndefined();
  });

  it.each([
    [1, 'Funded'],
    [2, 'Submitted'],
    [3, 'Completed'],
    [4, 'Rejected'],
    [5, 'Expired'],
  ])('rejects when on-chain status is %d (%s) (409 job_not_fundable_status)', async (statusCode, statusName) => {
    mocks.readOnchainJob.mockResolvedValue(makeOnchainJob({ status: statusCode, erc8183Status: statusName }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('job_not_fundable_status');
    expect(body.message).toMatch(statusName);
    expect(body.txs).toBeUndefined();
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it('returns approve/fund tx instructions when all guards pass', async () => {
    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.nextAction).toBe('approveAndFund');
    expect(body.localJobId).toBe(LOCAL_JOB_ID);
    expect(body.erc8183JobId).toBe('42');
    expect(body.txs).toHaveLength(2);

    // Approve tx
    expect(body.txs[0].functionName).toBe('approve');
    expect(body.txs[0].address).toBe('0x3600000000000000000000000000000000000000');
    expect(body.txs[0].args).toEqual(['0x0747000000000000000000000000000000000000', '2000000']);

    // Fund tx
    expect(body.txs[1].functionName).toBe('fund');
    expect(body.txs[1].address).toBe('0x0747000000000000000000000000000000000000');
    expect(body.txs[1].args).toEqual(['42', '0x']);
  });

  it('returns tx when status is created and setBudgetTxHash exists', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ status: 'created', setBudgetTxHash: '0x2222', fundTxHash: null }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.txs).toHaveLength(2);
  });

  // ── Budget mismatch warning (non-blocking) ──────────────────────────────

  it('logs warning on budget mismatch but still returns tx', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.readOnchainJob.mockResolvedValue(makeOnchainJob({ budget: 3000000n })); // different from local 2000000

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.txs).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('budget_mismatch'),
    );
    warnSpy.mockRestore();
  });

  // ── Error handling ──────────────────────────────────────────────────────

  it('returns 500 on unexpected error', async () => {
    mocks.getErc8183JobByLocalId.mockRejectedValue(new Error('db exploded'));

    const res = await POST(makeRequest(), { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('fund_failed');
    expect(body.message).toBe('db exploded');
  });
});
