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
import { encodeAbiParameters, encodeEventTopics } from 'viem';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  getErc8183JobByLocalId: vi.fn(),
  readTransactionReceipt: vi.fn(),
  readOnchainJob: vi.fn(),
  getArcPublicClient: vi.fn(),
  attachErc8183CompleteTx: vi.fn(),
  attachErc8183RejectTx: vi.fn(),
  attachErc8183SetBudgetTx: vi.fn(),
  attachErc8183ApproveTx: vi.fn(),
  attachErc8183FundTx: vi.fn(),
  attachErc8183SubmitTx: vi.fn(),
  updateErc8183Status: vi.fn(),
  assertErc8183Participant: vi.fn(),
  isErc8183Admin: vi.fn(),
  escrowRail: vi.fn(),
  checkMemoryRateLimit: vi.fn(),
  parseJobCompleted: vi.fn(),
  parseJobRejected: vi.fn(),
  parseJobExpired: vi.fn(),
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
  attachErc8183RejectTx: mocks.attachErc8183RejectTx,
  updateErc8183Status: mocks.updateErc8183Status,
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
  parseJobRejected: mocks.parseJobRejected,
  parseJobExpired: mocks.parseJobExpired,
}));

vi.mock('@arclayer/sdk', () => ({
  ARC_TOKENS: { USDC: '0x3600000000000000000000000000000000000000' },
}));

// ── Import after mocks ────────────────────────────────────────────────────

import { POST } from './route';

// ── Test fixtures ─────────────────────────────────────────────────────────

const LOCAL_JOB_ID = 'erc8183_complete_test';
const BUYER_AGENT = 'buyer-agent-001';
const WORKER_AGENT = '32965';
const PROVIDER_AGENT = '32966';
const WORKER_AGENT_INVALID = 'worker-agent-001';
const PROVIDER_AGENT_INVALID = 'provider-agent-001';
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

function makeApprovalReceipt() {
  const owner = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20' as `0x${string}`;
  const spender = '0x0747000000000000000000000000000000000000' as `0x${string}`;

  return {
    ...makeReceipt(),
    logs: [{
      address: '0x3600000000000000000000000000000000000000' as `0x${string}`,
      data: encodeAbiParameters([{ type: 'uint256' }], [2_000_000n]),
      topics: encodeEventTopics({
        abi: [{
          type: 'event',
          name: 'Approval',
          inputs: [
            { type: 'address', name: 'owner', indexed: true },
            { type: 'address', name: 'spender', indexed: true },
            { type: 'uint256', name: 'value', indexed: false },
          ],
        }],
        eventName: 'Approval',
        args: { owner, spender },
      }),
    }],
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

function makeRawRequest(body: string, accept = 'application/json') {
  return new NextRequest(`http://localhost/api/erc8183-jobs/${LOCAL_JOB_ID}/tx`, {
    method: 'POST',
    headers: {
      Accept: accept,
      'Content-Type': 'application/json',
      Authorization: 'Bearer ak_test',
    },
    body,
  });
}

function makeRequest(body: Record<string, unknown>, accept = 'application/json') {
  return new NextRequest(`http://localhost/api/erc8183-jobs/${LOCAL_JOB_ID}/tx`, {
    method: 'POST',
    headers: {
      Accept: accept,
      'Content-Type': 'application/json',
      Authorization: 'Bearer ak_test',
    },
    body: JSON.stringify(body),
  });
}

const SENSITIVE_HEADERS = [
  'Cache-Control',
  'PAYMENT-RESPONSE',
  'X-PAYMENT',
  'X-PAYMENT-RESPONSE',
  'PAYMENT-SIGNATURE',
  'Retry-After',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
] as const;

async function captureResponse(res: Response) {
  const text = await res.text();
  return {
    status: res.status,
    headers: Object.fromEntries(SENSITIVE_HEADERS.map((header) => [header, res.headers.get(header)])),
    body: JSON.parse(text),
    text,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/erc8183-jobs/[localJobId]/tx — complete/reject + recordDelivery', () => {
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

    mocks.parseJobRejected.mockReturnValue({
      jobId: JOB_ID_BIGINT,
      reason: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    });
    mocks.parseJobExpired.mockReturnValue(null);

    // Default: tx attachment succeeds
    mocks.attachErc8183CompleteTx.mockResolvedValue(undefined);
    mocks.attachErc8183RejectTx.mockResolvedValue(undefined);
    mocks.updateErc8183Status.mockResolvedValue(undefined);

    // Default: recordDelivery succeeds
    mocks.recordDelivery.mockResolvedValue({ txHash: '0xrep' });

    // Default: escrow rail
    mocks.escrowRail.mockReturnValue({ rail: 'escrow', settlementMode: 'erc8183_escrow' });
  });


  it('returns stable invalid_json across Accept modes for malformed JSON bodies', async () => {
    const applicationJson = await captureResponse(await POST(
      makeRawRequest('{', 'application/json'),
      { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) },
    ));
    const textHtml = await captureResponse(await POST(
      makeRawRequest('{', 'text/html'),
      { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) },
    ));

    expect(textHtml.status).toBe(applicationJson.status);
    expect(textHtml.headers).toEqual(applicationJson.headers);
    expect(textHtml.body).toEqual(applicationJson.body);
    expect(applicationJson.text).not.toContain('\n  ');
    expect(textHtml.text).toContain('\n  ');
    expect(applicationJson.status).toBe(400);
    expect(applicationJson.body).toMatchObject({
      ok: false,
      rail: 'escrow',
      settlementMode: 'erc8183_escrow',
      error: 'invalid_json',
      message: 'Request body must be JSON.',
    });
  });


  it('redacts generic tx confirmation failures across Accept modes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.readTransactionReceipt.mockRejectedValue(new Error('raw receipt rpc secret'));

    const applicationJson = await captureResponse(await POST(
      makeRequest({ txType: 'complete', txHash: TX_HASH }, 'application/json'),
      { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) },
    ));
    const textHtml = await captureResponse(await POST(
      makeRequest({ txType: 'complete', txHash: TX_HASH }, 'text/html'),
      { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) },
    ));

    expect(textHtml.status).toBe(applicationJson.status);
    expect(textHtml.headers).toEqual(applicationJson.headers);
    expect(textHtml.body).toEqual(applicationJson.body);
    expect(applicationJson.text).not.toContain('\n  ');
    expect(textHtml.text).toContain('\n  ');
    expect(applicationJson.status).toBe(500);
    expect(applicationJson.body).toMatchObject({
      ok: false,
      rail: 'escrow',
      settlementMode: 'erc8183_escrow',
      error: 'tx_confirmation_failed',
      message: 'Transaction confirmation failed. Please retry or contact support if the issue persists.',
    });
    expect(applicationJson.text).not.toContain('raw receipt rpc secret');
    expect(textHtml.text).not.toContain('raw receipt rpc secret');
    consoleError.mockRestore();
  });

  it('redacts allowance_check_failed provider errors across Accept modes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.readTransactionReceipt.mockResolvedValue(makeApprovalReceipt());
    mocks.getArcPublicClient.mockReturnValue({
      readContract: vi.fn().mockRejectedValue(new Error('raw rpc provider secret')),
    });

    const applicationJson = await captureResponse(await POST(
      makeRequest({ txType: 'approve', txHash: TX_HASH }, 'application/json'),
      { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) },
    ));
    const textHtml = await captureResponse(await POST(
      makeRequest({ txType: 'approve', txHash: TX_HASH }, 'text/html'),
      { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) },
    ));

    expect(textHtml.status).toBe(applicationJson.status);
    expect(textHtml.headers).toEqual(applicationJson.headers);
    expect(textHtml.body).toEqual(applicationJson.body);
    expect(applicationJson.text).not.toContain('\n  ');
    expect(textHtml.text).toContain('\n  ');
    expect(applicationJson.status).toBe(503);
    expect(applicationJson.body).toMatchObject({
      ok: false,
      rail: 'escrow',
      settlementMode: 'erc8183_escrow',
      error: 'allowance_check_failed',
      txType: 'approve',
      message: 'Failed to verify USDC allowance after approve tx.',
    });
    expect(applicationJson.text).not.toContain('raw rpc provider secret');
    expect(textHtml.text).not.toContain('raw rpc provider secret');
    consoleError.mockRestore();
  });

  it('preserves status, sensitive headers, and body schema across Accept modes for stable rate-limit errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const resetAt = Date.now() + 60_000;
    mocks.checkMemoryRateLimit.mockReturnValue({
      ok: false,
      limit: 20,
      remaining: 0,
      resetAt,
    });

    const applicationJson = await captureResponse(await POST(
      makeRequest({ txType: 'complete', txHash: TX_HASH }, 'application/json'),
      { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) },
    ));
    const textHtml = await captureResponse(await POST(
      makeRequest({ txType: 'complete', txHash: TX_HASH }, 'text/html'),
      { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) },
    ));

    expect(textHtml.status).toBe(applicationJson.status);
    expect(textHtml.headers).toEqual(applicationJson.headers);
    expect(textHtml.body).toEqual(applicationJson.body);
    expect(applicationJson.text).not.toContain('\n  ');
    expect(textHtml.text).toContain('\n  ');
    expect(applicationJson.status).toBe(429);
    expect(applicationJson.headers).toMatchObject({
      'Cache-Control': null,
      'PAYMENT-RESPONSE': null,
      'X-PAYMENT': null,
      'X-PAYMENT-RESPONSE': null,
      'PAYMENT-SIGNATURE': null,
      'Retry-After': '60',
      'X-RateLimit-Limit': '20',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
    });
    expect(applicationJson.body).toMatchObject({
      ok: false,
      rail: 'escrow',
      settlementMode: 'erc8183_escrow',
      error: 'rate_limited',
      limit: 20,
      remaining: 0,
    });
  });

  it('confirms claim_refund from on-chain Expired status without requiring JobExpired', async () => {
    mocks.readOnchainJob.mockResolvedValue({
      ...makeOnchainJob(),
      status: 5,
      erc8183Status: 'Expired',
    });

    const req = makeRequest({ txType: 'claim_refund', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body).toMatchObject({
      ok: true,
      localJobId: LOCAL_JOB_ID,
      erc8183JobId: '42',
      txType: 'claim_refund',
      txHash: TX_HASH,
      erc8183Status: 'Expired',
      onchainStatus: 5,
      blockNumber: 45000000,
    });
    expect(mocks.assertErc8183Participant).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ['buyer'],
    );
    expect(mocks.parseJobExpired).toHaveBeenCalled();
    expect(mocks.updateErc8183Status).toHaveBeenCalledWith({
      localJobId: LOCAL_JOB_ID,
      erc8183Status: 'Expired',
      status: 'expired',
    });
  });

  it('returns 422 when claim_refund does not produce Expired on-chain status', async () => {
    mocks.readOnchainJob.mockResolvedValue({
      ...makeOnchainJob(),
      status: 1,
      erc8183Status: 'Funded',
    });

    const req = makeRequest({ txType: 'claim_refund', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body).toMatchObject({
      error: 'onchain_status_not_expired',
      txType: 'claim_refund',
      erc8183Status: 'Funded',
      onchainStatus: 1,
    });
    expect(mocks.updateErc8183Status).not.toHaveBeenCalled();
  });

  it('calls recordDelivery with workerId when workerId exists', async () => {
    const req = makeRequest({ txType: 'complete', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mocks.recordDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.recordDelivery).toHaveBeenCalledWith(expect.objectContaining({
      providerAgentId: WORKER_AGENT,
      buyerAgentId: BUYER_AGENT,
      jobId: LOCAL_JOB_ID,
      delivered: true,
    }));
  });

  it('calls recordDelivery with providerAgentId when workerId is missing', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ workerId: null }));

    const req = makeRequest({ txType: 'complete', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mocks.recordDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.recordDelivery).toHaveBeenCalledWith(expect.objectContaining({
      providerAgentId: PROVIDER_AGENT,
      buyerAgentId: BUYER_AGENT,
      jobId: LOCAL_JOB_ID,
      delivered: true,
    }));
  });

  it('passes complete proof-binding fields to recordDelivery', async () => {
    const deliverableHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const proofPayloadHash = 'proof-hash';
    const resultPayloadHash = 'result-hash';
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({
      deliverableHash,
      proofPayloadHash,
      resultPayloadHash,
    }));

    const req = makeRequest({ txType: 'complete', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mocks.recordDelivery).toHaveBeenCalledWith({
      providerAgentId: WORKER_AGENT,
      buyerAgentId: BUYER_AGENT,
      jobId: LOCAL_JOB_ID,
      delivered: true,
      deliverableHash,
      reasonHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      submitTxHash: '0x5555',
      completeTxHash: TX_HASH,
      proofPayloadHash,
      resultPayloadHash,
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

  it('falls back to providerAgentId when workerId has invalid token id format', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(
      makeJob({ workerId: WORKER_AGENT_INVALID }),
    );

    const req = makeRequest({ txType: 'complete', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mocks.recordDelivery).toHaveBeenCalledTimes(1);
    expect(mocks.recordDelivery).toHaveBeenCalledWith(expect.objectContaining({
      providerAgentId: PROVIDER_AGENT,
      buyerAgentId: BUYER_AGENT,
      jobId: LOCAL_JOB_ID,
      delivered: true,
    }));
  });

  it('does not call recordDelivery when both workerId and providerAgentId have invalid format', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(
      makeJob({ workerId: WORKER_AGENT_INVALID, providerAgentId: PROVIDER_AGENT_INVALID }),
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

  it('confirms reject, attaches the reject tx, and records delivery as failed', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({
      erc8183Status: 'Submitted',
      deliverableHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      rejectReasonHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      proofPayloadHash: 'proof-hash',
      resultPayloadHash: 'result-hash',
    }));
    mocks.readOnchainJob.mockResolvedValue({
      ...makeOnchainJob(),
      status: 4,
      erc8183Status: 'Rejected',
    });

    const req = makeRequest({
      txType: 'reject',
      txHash: TX_HASH,
      reasonText: 'invalid deliverable',
      reason: 'legacy reason alias',
    });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body).toMatchObject({
      ok: true,
      rail: 'escrow',
      settlementMode: 'erc8183_escrow',
      localJobId: LOCAL_JOB_ID,
      erc8183JobId: '42',
      txType: 'reject',
      txHash: TX_HASH,
      erc8183Status: 'Rejected',
      onchainStatus: 4,
      blockNumber: 45000000,
    });
    expect(mocks.attachErc8183RejectTx).toHaveBeenCalledWith({
      localJobId: LOCAL_JOB_ID,
      rejectTxHash: TX_HASH,
      rejectReasonText: 'invalid deliverable',
      rejectReasonHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    });
    expect(mocks.recordDelivery).toHaveBeenCalledWith({
      providerAgentId: WORKER_AGENT,
      buyerAgentId: BUYER_AGENT,
      jobId: LOCAL_JOB_ID,
      delivered: false,
      deliverableHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      rejectReasonHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      submitTxHash: '0x5555',
      rejectTxHash: TX_HASH,
      proofPayloadHash: 'proof-hash',
      resultPayloadHash: 'result-hash',
    });
  });

  it('returns 422 when reject receipt has no matching JobRejected event', async () => {
    mocks.parseJobRejected.mockReturnValue(null);

    const req = makeRequest({ txType: 'reject', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toBe('missing_expected_event');
    expect(body.txType).toBe('reject');
    expect(mocks.attachErc8183RejectTx).not.toHaveBeenCalled();
  });

  it('does not compare complete reasonHash when rejectReasonHash is absent', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({
      reasonHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      rejectReasonHash: null,
    }));
    mocks.readOnchainJob.mockResolvedValue({
      ...makeOnchainJob(),
      status: 4,
      erc8183Status: 'Rejected',
    });

    const req = makeRequest({ txType: 'reject', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mocks.attachErc8183RejectTx).toHaveBeenCalledTimes(1);
  });

  it('returns 422 when reject reason does not match the prepared reason hash', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({
      rejectReasonHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }));

    const req = makeRequest({ txType: 'reject', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body).toMatchObject({
      error: 'event_reason_mismatch',
      txType: 'reject',
      expectedReason: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      eventReason: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    });
    expect(mocks.attachErc8183RejectTx).not.toHaveBeenCalled();
  });

  it('returns 422 when on-chain job is not Rejected', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ rejectReasonHash: null }));
    mocks.readOnchainJob.mockResolvedValue({
      ...makeOnchainJob(),
      status: 2,
      erc8183Status: 'Submitted',
    });

    const req = makeRequest({ txType: 'reject', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toBe('onchain_status_not_rejected');
    expect(mocks.attachErc8183RejectTx).not.toHaveBeenCalled();
  });

  it('does not fail reject confirmation when recordDelivery throws', async () => {
    mocks.getErc8183JobByLocalId.mockResolvedValue(makeJob({ erc8183Status: 'Submitted' }));
    mocks.readOnchainJob.mockResolvedValue({
      ...makeOnchainJob(),
      status: 4,
      erc8183Status: 'Rejected',
    });
    mocks.recordDelivery.mockRejectedValue(new Error('on-chain write failed'));

    const req = makeRequest({ txType: 'reject', txHash: TX_HASH });
    const res = await POST(req, { params: Promise.resolve({ localJobId: LOCAL_JOB_ID }) });
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.txType).toBe('reject');
    expect(mocks.attachErc8183RejectTx).toHaveBeenCalledTimes(1);
  });
});
