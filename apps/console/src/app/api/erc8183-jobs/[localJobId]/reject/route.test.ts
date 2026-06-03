/**
 * Tests for ERC-8183 reject route.
 *
 * Verifies:
 * - returns 401/403 without erc8183:reject scope
 * - returns 403 if caller is not evaluator
 * - returns 422 if local status is not Submitted
 * - returns 422 if on-chain status is not Submitted
 * - returns 400 if reasonText empty
 * - returns 400 if reasonText too long
 * - returns 400 if optParams invalid hex
 * - returns 400 if invalid JSON body
 * - returns 409 if reject already in progress
 * - success stores reject tx hash + Rejected status
 * - tx revert rolls back status
 * - reputation write fires on success
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  getErc8183JobByLocalId: vi.fn(),
  attachErc8183RejectTx: vi.fn(),
  claimErc8183Reject: vi.fn(),
  markErc8183RejectFailed: vi.fn(),
  assertErc8183Participant: vi.fn(),
  isErc8183Admin: vi.fn(),
  readOnchainJob: vi.fn(),
  getArcPublicClient: vi.fn(),
  escrowRail: vi.fn(),
  checkMemoryRateLimit: vi.fn(),
  writeReputationFeedback: vi.fn(),
  extractAgentTokenId: vi.fn(),
  normalizePrivateKey: vi.fn(),
  createWalletClient: vi.fn(),
  privateKeyToAccount: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/a2a/auth', () => ({
  requireApiKey: mocks.requireApiKey,
  API_KEY_SCOPES: { ERC8183_REJECT: 'erc8183:reject' },
}));

vi.mock('@/lib/a2a/reputation', () => ({
  writeReputationFeedback: mocks.writeReputationFeedback,
  extractAgentTokenId: mocks.extractAgentTokenId,
}));

vi.mock('@/lib/a2a/utils', () => ({
  normalizePrivateKey: mocks.normalizePrivateKey,
}));

vi.mock('@/lib/erc8183-jobs/store', () => ({
  getErc8183JobByLocalId: mocks.getErc8183JobByLocalId,
  attachErc8183RejectTx: mocks.attachErc8183RejectTx,
  claimErc8183Reject: mocks.claimErc8183Reject,
  markErc8183RejectFailed: mocks.markErc8183RejectFailed,
}));

vi.mock('@/lib/erc8183-jobs/receipt', () => ({
  readOnchainJob: mocks.readOnchainJob,
  getArcPublicClient: mocks.getArcPublicClient,
}));

vi.mock('@/lib/erc8183-jobs/authz', () => ({
  assertErc8183Participant: mocks.assertErc8183Participant,
  isErc8183Admin: mocks.isErc8183Admin,
}));

vi.mock('@/lib/rails/responses', () => ({
  escrowRail: mocks.escrowRail,
}));

vi.mock('@/lib/rate-limit/memory', () => ({
  checkMemoryRateLimit: mocks.checkMemoryRateLimit,
}));

vi.mock('@/lib/contracts/erc8183', () => ({
  ERC8183_ABI: [],
}));

vi.mock('@arclayer/sdk', () => ({
  arcTestnet: {},
  CONTRACTS: { ERC8183_AGENTIC_COMMERCE: '0x0747EEf0706327138c69792bF28Cd525089e4583' },
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    keccak256: vi.fn(() => '0xreasonhash'),
    toBytes: vi.fn((s: string) => new TextEncoder().encode(s)),
    isHex: (v: string) => typeof v === 'string' && v.startsWith('0x'),
    createWalletClient: mocks.createWalletClient,
    http: vi.fn(),
  };
});

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: mocks.privateKeyToAccount,
}));

// ── Test helpers ──────────────────────────────────────────────────────────

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    localJobId: 'erc8183_test123',
    erc8183JobId: '42',
    erc8183Status: 'Submitted',
    status: 'submitted',
    buyerAgentId: '100',
    providerAgentId: '200',
    evaluatorAgentId: '300',
    clientAddress: '0xClient',
    providerAddress: '0xProvider',
    evaluatorAddress: '0xEvaluator',
    workerId: '200',
    priceAtomic: '1000000',
    ...overrides,
  };
}

function makeRequest(body?: unknown, cookie?: string): NextRequest {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (cookie) headers.set('Cookie', `session=${cookie}`);
  const init: RequestInit = {
    method: 'POST',
    headers,
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest('http://localhost/api/erc8183-jobs/erc8183_test123/reject', init);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/erc8183-jobs/[localJobId]/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.escrowRail.mockReturnValue({ rail: 'escrow', settlementMode: 'erc8183_escrow' });
    mocks.checkMemoryRateLimit.mockReturnValue({ ok: true, limit: 10, remaining: 9, resetAt: Date.now() + 300_000 });
    mocks.isErc8183Admin.mockReturnValue(false);
    mocks.assertErc8183Participant.mockReturnValue(null);
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob());
    mocks.claimErc8183Reject.mockResolvedValue(true);
    mocks.readOnchainJob.mockResolvedValue({ erc8183Status: 'Submitted' });
    mocks.normalizePrivateKey.mockReturnValue('0xabcdef1234567890');
    mocks.privateKeyToAccount.mockReturnValue({ address: '0xEvaluator' });
    mocks.createWalletClient.mockReturnValue({
      writeContract: vi.fn().mockResolvedValue('0xrejhash'),
    });
    mocks.getArcPublicClient.mockReturnValue({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', blockNumber: 123n }),
    });
    mocks.attachErc8183RejectTx.mockResolvedValue(undefined);
    mocks.extractAgentTokenId.mockReturnValue('200');
    mocks.writeReputationFeedback.mockResolvedValue({ txHash: '0xrep' });
  });

  // ── Auth ──────────────────────────────────────────────────────────────

  it('returns 401 without erc8183:reject scope', async () => {
    mocks.requireApiKey.mockResolvedValue({
      error: new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 }),
    });

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reasonText: 'test' }), { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 if caller is not evaluator', async () => {
    mocks.requireApiKey.mockResolvedValue({ key: { id: 'k1', agentId: '999', scopes: ['erc8183:reject'] } });
    const errorResponse = new Response(JSON.stringify({ ok: false, error: 'participant_mismatch' }), { status: 403 });
    mocks.assertErc8183Participant.mockReturnValue(errorResponse);

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reasonText: 'test' }), { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });
    expect(res.status).toBe(403);
  });

  // ── Status guards ─────────────────────────────────────────────────────

  it('returns 422 if local status is not Submitted', async () => {
    mocks.requireApiKey.mockResolvedValue({ key: { id: 'k1', agentId: '300', scopes: ['erc8183:reject'] } });
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ erc8183Status: 'Completed' }));

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reasonText: 'test' }), { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('invalid_status_for_reject');
  });

  it('returns 422 if on-chain status is not Submitted', async () => {
    mocks.requireApiKey.mockResolvedValue({ key: { id: 'k1', agentId: '300', scopes: ['erc8183:reject'] } });
    mocks.readOnchainJob.mockResolvedValue({ erc8183Status: 'Funded' });

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reasonText: 'test' }), { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('onchain_status_mismatch');
  });

  // ── Input validation ──────────────────────────────────────────────────

  it('returns 400 if reasonText empty', async () => {
    mocks.requireApiKey.mockResolvedValue({ key: { id: 'k1', agentId: '300', scopes: ['erc8183:reject'] } });

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reasonText: '' }), { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_reason_text');
  });

  it('returns 400 if reasonText too long', async () => {
    mocks.requireApiKey.mockResolvedValue({ key: { id: 'k1', agentId: '300', scopes: ['erc8183:reject'] } });

    const { POST } = await import('./route');
    const longReason = 'x'.repeat(2001);
    const res = await POST(makeRequest({ reasonText: longReason }), { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('reason_text_too_long');
  });

  it('returns 400 if optParams invalid hex', async () => {
    mocks.requireApiKey.mockResolvedValue({ key: { id: 'k1', agentId: '300', scopes: ['erc8183:reject'] } });

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reasonText: 'test', optParams: 'not-hex' }), { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_opt_params');
  });

  it('returns 400 if invalid JSON body', async () => {
    mocks.requireApiKey.mockResolvedValue({ key: { id: 'k1', agentId: '300', scopes: ['erc8183:reject'] } });

    const headers = new Headers({ 'Content-Type': 'application/json' });
    const req = new NextRequest('http://localhost/api/erc8183-jobs/erc8183_test123/reject', {
      method: 'POST',
      headers,
      body: 'not json{{{',
    });

    const { POST } = await import('./route');
    const res = await POST(req, { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });

  // ── Race guard ────────────────────────────────────────────────────────

  it('returns 409 if reject already in progress', async () => {
    mocks.requireApiKey.mockResolvedValue({ key: { id: 'k1', agentId: '300', scopes: ['erc8183:reject'] } });
    mocks.claimErc8183Reject.mockResolvedValue(false);

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reasonText: 'test' }), { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('reject_already_in_progress_or_finalized');
  });

  // ── Success ───────────────────────────────────────────────────────────

  it('success stores reject tx hash + Rejected status', async () => {
    mocks.requireApiKey.mockResolvedValue({ key: { id: 'k1', agentId: '300', scopes: ['erc8183:reject'] } });

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reasonText: 'Manual rejection reason' }), { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rejectTxHash).toBe('0xrejhash');
    expect(body.erc8183Status).toBe('Rejected');
    expect(body.status).toBe('rejected');
    expect(mocks.attachErc8183RejectTx).toHaveBeenCalledWith({
      localJobId: 'erc8183_test123',
      rejectTxHash: '0xrejhash',
      rejectReasonText: 'Manual rejection reason',
      rejectReasonHash: '0xreasonhash',
    });
  });

  it('fires reputation write on success', async () => {
    mocks.requireApiKey.mockResolvedValue({ key: { id: 'k1', agentId: '300', scopes: ['erc8183:reject'] } });

    const { POST } = await import('./route');
    await POST(makeRequest({ reasonText: 'test' }), { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });

    // Wait for fire-and-forget
    await new Promise((r) => setTimeout(r, 10));

    expect(mocks.writeReputationFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        score: -50,
        context: 'erc8183_job_rejected',
      }),
    );
  });

  // ── Failure recovery ──────────────────────────────────────────────────

  it('tx revert rolls back status', async () => {
    mocks.requireApiKey.mockResolvedValue({ key: { id: 'k1', agentId: '300', scopes: ['erc8183:reject'] } });
    mocks.createWalletClient.mockReturnValue({
      writeContract: vi.fn().mockRejectedValue(new Error('execution reverted')),
    });

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reasonText: 'test' }), { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });
    expect(res.status).toBe(502);
    expect(mocks.markErc8183RejectFailed).toHaveBeenCalledWith({ localJobId: 'erc8183_test123' });
  });

  it('receipt timeout rolls back status', async () => {
    mocks.requireApiKey.mockResolvedValue({ key: { id: 'k1', agentId: '300', scopes: ['erc8183:reject'] } });
    mocks.createWalletClient.mockReturnValue({
      writeContract: vi.fn().mockResolvedValue('0xrejhash'),
    });
    mocks.getArcPublicClient.mockReturnValue({
      waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('timeout')),
    });

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ reasonText: 'test' }), { params: Promise.resolve({ localJobId: 'erc8183_test123' }) });
    expect(res.status).toBe(502);
    expect(mocks.markErc8183RejectFailed).toHaveBeenCalled();
  });
});
