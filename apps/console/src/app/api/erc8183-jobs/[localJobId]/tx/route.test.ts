/**
 * Tests for ERC-8183 tx route — recordDelivery bridge on complete.
 *
 * Verifies:
 * - complete tx calls recordDelivery with workerId when workerId exists
 * - complete tx calls recordDelivery with providerAgentId when workerId is missing
 * - complete tx does not fail if recordDelivery throws
 * - complete tx does not call recordDelivery if no worker/provider agent exists
 * - existing complete tx behavior remains unchanged
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  getErc8183JobByLocalId: vi.fn(),
  readTransactionReceipt: vi.fn(),
  readOnchainJob: vi.fn(),
  getArcPublicClient: vi.fn(),
  attachErc8183CompleteTx: vi.fn(),
  attachErc8183SetBudgetTx: vi.fn(),
  attachErc8183ApproveTx: vi.fn(),
  attachErc8183FundTx: vi.fn(),
  attachErc8183SubmitTx: vi.fn(),
  assertErc8183Participant: vi.fn(),
  isErc8183Admin: vi.fn(),
  escrowRail: vi.fn(),
  checkMemoryRateLimit: vi.fn(),
  parseJobCompleted: vi.fn(),
  parseBudgetSet: vi.fn(),
  parseJobFunded: vi.fn(),
  parseJobSubmitted: vi.fn(),
  recordDelivery: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────

vi.mock('@/lib/a2a/auth', () => ({
  requireApiKey: mocks.requireApiKey,
  API_KEY_SCOPES: { ERC8183_TX: 'erc8183:tx' },
}));

vi.mock('@/lib/a2a/reputation', () => ({
  recordDelivery: mocks.recordDelivery,
}));

vi.mock('@/lib/erc8183-jobs/store', () => ({
  getErc8183JobByLocalId: mocks.getErc8183JobByLocalId,
  attachErc8183SetBudgetTx: mocks.attachErc8183SetBudgetTx,
  attachErc8183ApproveTx: mocks.attachErc8183ApproveTx,
  attachErc8183FundTx: mocks.attachErc8183FundTx,
  attachErc8183SubmitTx: mocks.attachErc8183SubmitTx,
  attachErc8183CompleteTx: mocks.attachErc8183CompleteTx,
  Erc8183TxHashConflictError: class extends Error {
    constructor(
      public fieldName: string,
      public existingTxHash: string,
      public nextTxHash: string,
    ) {
      super('tx_hash_conflict');
      this.name = 'Erc8183TxHashConflictError';
    }
  },
}));

vi.mock('@/lib/erc8183-jobs/receipt', () => ({
  readTransactionReceipt: mocks.readTransactionReceipt,
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

vi.mock('@/lib/contracts', () => ({
  USDC_ABI: [],
  CONTRACTS: { ERC8183_AGENTIC_COMMERCE: '0x0747000000000000000000000000000000000000' },
}));

vi.mock('@/lib/contracts/erc8183', () => ({
  parseBudgetSet: mocks.parseBudgetSet,
  parseJobFunded: mocks.parseJobFunded,
  parseJobSubmitted: mocks.parseJobSubmitted,
  parseJobCompleted: mocks.parseJobCompleted,
}));

vi.mock('@arclayer/sdk', () => ({
  ARC_TOKENS: { USDC: '0x3600000000000000000000000000000000000000' },
}));

// ── Import after mocks ────────────────────────────────────────────────────

import { POST } from './route';

// ── Test fixtures ─────────────────────────────────────────────────────────

const LOCAL_JOB_ID = 'erc8183_complete_test';
const BUYER_AGENT = 'buyer-agent-001';
const WORKER_AGENT = 'worker-agent-001';
const PROVIDER_AGENT = 'provider-agent-001';
const TX_HASH = '0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1' as `0x${string}`;
const JOB_ID_BIGINT = 42n;

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    localJobId: LOCAL_JOB_ID,
    erc8183JobId: '42',
    settlementMode: 'erc8183_escrow',
    erc8183Status: 'Funded',
    status: 'claimed',
    buyerAgentId: BUYER_AGENT,
    clientAddress: '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20',
    providerAgentId: PROVIDER_AGENT,
    providerAddress: '0xb03141849F755b0a337b3352C2290fce66e0C6dD',
    evaluatorAgentId: 'evaluator-agent-001',
    evaluatorAddress: '0x0380542Fd05813461A71e9Befb80fBeA0AE656E8',
    workerId: WORKER_AGENT,
    priceAtomic: '2000000',
    description: 'Test job',
    expiredAtUnix: '1800000000',
    hookAddress: '0x0000000000000000000000000000000000000000',
    inputPayload: {},
    inputPayloadHash: 'aabb',
    resultPayload: null,
    resultPayloadHash: null,
    proofPayload: null,
    proofPayloadHash: null,
    deliverableHash: null,
    reasonHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    createTxHash: '0x1111',
    setBudgetTxHash: '0x2222',
    approveTxHash: '0x3333',
    fundTxHash: '0x4444',
    submitTxHash: '0x5555',
    completeTxHash: null,
    createdAt: '2026-01-01T00:00:00Z',
    claimedAt: '2026-01-01T00:01:00Z',
    startedAt: null,
    ...overrides,
  };
}

function makeReceipt() {
  return {
    status: 'success' as const,
    transactionHash: TX_HASH,
    from: '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20' as `0x${string}`,
    blockNumber: 45000000n,
    logs: [{ address: '0x0747000000000000000000000000000000000000', data: '0x', topics: [] }],
  };
}

function makeOnchainJob() {
  return {
    client: '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20',
    provider: '0xb03141849F755b0a337b3352C2290fce66e0C6dD',
    evaluator: '0x0380542Fd05813461A71e9Befb80fBeA0AE656E8',
    expiredAt: 1800000000n,
    hook: '0x0000000000000000000000000000000000000000',
    budget: '2000000',
    fundedAmount: '2000000',
    status: 3,
    erc8183Status: 'Completed',
    deliverable: '0x0000000000000000000000000000000000000000000000000000000000000000',
    completionReason: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    approved: true,
  };
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/erc8183-jobs/${LOCAL_JOB_ID}/tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ak_test' },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/erc8183-jobs/[localJobId]/tx — complete + recordDelivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: auth passes
    mocks.requireApiKey.mockReturnValue({ error: null, key: { id: 'k1', agentId: 'a1', scopes: ['erc8183:tx'] } });
    mocks.isErc8183Admin.mockReturnValue(false);

    // Default: rate limit passes
    mocks.checkMemoryRateLimit.mockReturnValue({ ok: true, limit: 20, remaining: 19, resetAt: Date.now() + 300000 });

    // Default: job found
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob());

    // Default: participant check passes
    mocks.assertErc8183Participant.mockReturnValue(null);

    // Default: receipt found and successful
    mocks.readTransactionReceipt.mockResolvedValue(makeReceipt());

    // Default: on-chain job matches
    mocks.readOnchainJob.mockResolvedValue(makeOnchainJob());

    // Default: JobCompleted event found
    mocks.parseJobCompleted.mockReturnValue({
      jobId: JOB_ID_BIGINT,
      reason: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    });

    // Default: attachErc8183CompleteTx succeeds
    mocks.attachErc8183CompleteTx.mockResolvedValue(undefined);

    // Default: recordDelivery succeeds
    mocks.recordDelivery.mockResolvedValue({ txHash: '0xrep' });

    // Default: escrow rail
    mocks.escrowRail.mockReturnValue({ rail: 'escrow', settlementMode: 'erc8183_escrow' });
  });

  it('calls recordDelivery with workerId when workerId exists', async () => {
    const req = makeRequest({ txType: 'complete', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mocks.recordDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.recordDelivery).toHaveBeenCalledWith({
      providerAgentId: WORKER_AGENT,
      buyerAgentId: BUYER_AGENT,
      jobId: LOCAL_JOB_ID,
      delivered: true,
    });
  });

  it('calls recordDelivery with providerAgentId when workerId is missing', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ workerId: null }));

    const req = makeRequest({ txType: 'complete', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mocks.recordDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.recordDelivery).toHaveBeenCalledWith({
      providerAgentId: PROVIDER_AGENT,
      buyerAgentId: BUYER_AGENT,
      jobId: LOCAL_JOB_ID,
      delivered: true,
    });
  });

  it('does not fail complete tx if recordDelivery throws', async () => {
    mocks.recordDelivery.mockRejectedValue(new Error('on-chain write failed'));

    const req = makeRequest({ txType: 'complete', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    // Complete tx should still succeed
    expect(body.ok).toBe(true);
    expect(body.txType).toBe('complete');
    expect(mocks.attachErc8183CompleteTx).toHaveBeenCalledTimes(1);
  });

  it('does not call recordDelivery if no worker/provider agent exists', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(
      makeJob({ workerId: null, providerAgentId: null }),
    );

    const req = makeRequest({ txType: 'complete', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mocks.recordDelivery).not.toHaveBeenCalled();
  });

  it('preserves existing complete tx behavior — returns correct shape', async () => {
    const req = makeRequest({ txType: 'complete', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.rail).toBe('escrow');
    expect(body.settlementMode).toBe('erc8183_escrow');
    expect(body.localJobId).toBe(LOCAL_JOB_ID);
    expect(body.erc8183JobId).toBe('42');
    expect(body.txType).toBe('complete');
    expect(body.txHash).toBe(TX_HASH);
    expect(body.erc8183Status).toBe('Completed');
    expect(body.message).toContain('escrow settled');
  });
});
