/**
 * Tests for POST /api/erc8183-jobs/web-hire/created
 *
 * Covers: event field validation (client, expiredAt, hook, provider, evaluator),
 * tx sender mismatch, preparation status transitions, local job creation guard.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  resolveSessionFromCookie: vi.fn(),
  getLinkedErc8004AgentsForController: vi.fn(),
  readTransactionReceipt: vi.fn(),
  decodeJobCreatedFromReceipt: vi.fn(),
  createLocalErc8183Job: vi.fn(),
  attachErc8183CreateTx: vi.fn(),
  supabaseUpdate: vi.fn(),
  supabaseSelect: vi.fn(),
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

vi.mock('@/lib/erc8183-jobs/receipt', () => ({
  readTransactionReceipt: mocks.readTransactionReceipt,
  decodeJobCreatedFromReceipt: mocks.decodeJobCreatedFromReceipt,
}));

vi.mock('@/lib/erc8183-jobs/store', () => ({
  createLocalErc8183Job: mocks.createLocalErc8183Job,
  attachErc8183CreateTx: mocks.attachErc8183CreateTx,
}));

// Chainable Supabase mock: .from().update().eq().eq().select()
function chainableUpdate() {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: { data: unknown; error: null }) => void) =>
    resolve({ data: null, error: null });
  return chain;
}

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'erc8183_hire_preparations') {
        return {
          update: mocks.supabaseUpdate,
          select: mocks.supabaseSelect,
        };
      }
      return { update: vi.fn().mockReturnValue(chainableUpdate()), select: vi.fn() };
    },
  }),
}));

// ── Import after mocks ────────────────────────────────────────────────────

import { POST } from './route';
import { NextRequest } from 'next/server';

// ── Test fixtures ─────────────────────────────────────────────────────────

const BUYER_CTRL = '0xF5f11E68fbcbfa20De9208709aB60fF81509Cb20';
const PROVIDER_CTRL = '0xb03141849F755b0a337b3352C2290fce66e0C6dD';
const EVALUATOR_CTRL = '0x0380542Fd05813461A71e9Befb80fBeA0AE656E8';
const ZERO_HOOK = '0x0000000000000000000000000000000000000000';
const PREPARE_ID = 'prep-abc-123';
const TX_HASH = '0x' + 'a'.repeat(64);
const EXPIRED_AT_UNIX = '1800000000';

const PREP_ROW = {
  id: PREPARE_ID,
  buyer_agent_id: 'buyer-001',
  provider_agent_id: 'provider-001',
  evaluator_agent_id: 'evaluator-001',
  evaluator_mode: 'explicit',
  buyer_controller: BUYER_CTRL,
  provider_controller: PROVIDER_CTRL,
  evaluator_controller: EVALUATOR_CTRL,
  budget_atomic: '2000000',
  expired_at_unix: EXPIRED_AT_UNIX,
  description: 'Test job',
  hook: ZERO_HOOK,
  input_payload_hash: 'hash123',
  prepared_by_wallet: BUYER_CTRL,
  status: 'prepared',
  create_tx_hash: null,
  erc8183_job_id: null,
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
};

const MOCK_RECEIPT = {
  status: 'success' as const,
  transactionHash: TX_HASH,
  from: BUYER_CTRL as `0x${string}`,
  blockNumber: 12345n,
  logs: [],
};

const MATCHING_EVENT = {
  jobId: 42n,
  client: BUYER_CTRL as `0x${string}`,
  provider: PROVIDER_CTRL as `0x${string}`,
  evaluator: EVALUATOR_CTRL as `0x${string}`,
  expiredAt: BigInt(EXPIRED_AT_UNIX),
  hook: ZERO_HOOK as `0x${string}`,
};

// ── Helpers ───────────────────────────────────────────────────────────────

function makeCreatedRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/erc8183-jobs/web-hire/created', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function setupSuccessfulClaim() {
  // Chainable mock for: .from('erc8183_hire_preparations').update({...}).eq(...).eq(...).select('*')
  const selectChain = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data: [PREP_ROW], error: null }),
    then: undefined as unknown,
  };
  // .update({}).eq().eq().select() returns the selectChain
  const eq2Chain = {
    eq: vi.fn().mockReturnValue(selectChain),
    select: vi.fn().mockResolvedValue({ data: [PREP_ROW], error: null }),
  };
  const eq1Chain = {
    eq: vi.fn().mockReturnValue(eq2Chain),
    select: vi.fn().mockResolvedValue({ data: [PREP_ROW], error: null }),
  };
  const updateReturn = {
    eq: vi.fn().mockReturnValue(eq1Chain),
    select: vi.fn().mockResolvedValue({ data: [PREP_ROW], error: null }),
  };

  // The "maybeSingle" chain for the 409 lookup path
  const maybeSingleChain = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  };

  mocks.supabaseUpdate.mockReturnValue(updateReturn);
  mocks.supabaseSelect.mockReturnValue(maybeSingleChain);
}

function setupClaimConflict(status = 'creating') {
  // Claim returns empty (already claimed)
  const selectChain = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  const eq2Chain = {
    eq: vi.fn().mockReturnValue(selectChain),
    select: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  const eq1Chain = {
    eq: vi.fn().mockReturnValue(eq2Chain),
    select: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  const updateReturn = {
    eq: vi.fn().mockReturnValue(eq1Chain),
    select: vi.fn().mockResolvedValue({ data: [], error: null }),
  };

  const maybeSingleChain = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { status, erc8183_job_id: status === 'created' ? '42' : null, create_tx_hash: null },
    }),
  };

  mocks.supabaseUpdate.mockReturnValue(updateReturn);
  mocks.supabaseSelect.mockReturnValue(maybeSingleChain);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/erc8183-jobs/web-hire/created', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: API key auth succeeds
    mocks.requireApiKey.mockResolvedValue({
      key: { id: 'key-1', agentId: 'api-agent', scopes: ['erc8183:create'] },
    });

    // Default: successful claim
    setupSuccessfulClaim();

    // Default: receipt found and succeeded
    mocks.readTransactionReceipt.mockResolvedValue(MOCK_RECEIPT);

    // Default: JobCreated event with all matching fields
    mocks.decodeJobCreatedFromReceipt.mockReturnValue(MATCHING_EVENT);

    // Default: local job creation succeeds
    mocks.createLocalErc8183Job.mockResolvedValue({ localJobId: 'local-001' });
    mocks.attachErc8183CreateTx.mockResolvedValue(undefined);
  });

  // ── Happy path ────────────────────────────────────────────────────────

  it('matching client/expiredAt/hook/provider/evaluator succeeds (200)', async () => {
    const res = await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.localJobId).toBe('local-001');
    expect(data.erc8183JobId).toBe('42');
    expect(data.createTxHash).toBe(TX_HASH);
    expect(mocks.createLocalErc8183Job).toHaveBeenCalledOnce();
  });

  // ── client mismatch ───────────────────────────────────────────────────

  it('mismatched client rejected (422 event_client_mismatch)', async () => {
    mocks.decodeJobCreatedFromReceipt.mockReturnValue({
      ...MATCHING_EVENT,
      client: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' as `0x${string}`,
    });

    const res = await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error).toBe('event_client_mismatch');
    expect(data.ok).toBe(false);
  });

  it('rejected client mismatch does not create local job', async () => {
    mocks.decodeJobCreatedFromReceipt.mockReturnValue({
      ...MATCHING_EVENT,
      client: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' as `0x${string}`,
    });

    await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));

    expect(mocks.createLocalErc8183Job).not.toHaveBeenCalled();
  });

  it('rejected client mismatch marks preparation as failed', async () => {
    mocks.decodeJobCreatedFromReceipt.mockReturnValue({
      ...MATCHING_EVENT,
      client: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' as `0x${string}`,
    });

    await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));

    // Verify .update({ status: 'failed' }) was called
    expect(mocks.supabaseUpdate).toHaveBeenCalledWith({ status: 'failed' });
  });

  // ── expiredAt mismatch ────────────────────────────────────────────────

  it('mismatched expiredAt rejected (422 event_expired_at_mismatch)', async () => {
    mocks.decodeJobCreatedFromReceipt.mockReturnValue({
      ...MATCHING_EVENT,
      expiredAt: 9999999999n,
    });

    const res = await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error).toBe('event_expired_at_mismatch');
    expect(data.ok).toBe(false);
  });

  it('rejected expiredAt mismatch does not create local job', async () => {
    mocks.decodeJobCreatedFromReceipt.mockReturnValue({
      ...MATCHING_EVENT,
      expiredAt: 9999999999n,
    });

    await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));

    expect(mocks.createLocalErc8183Job).not.toHaveBeenCalled();
  });

  // ── hook mismatch ─────────────────────────────────────────────────────

  it('mismatched hook rejected (422 event_hook_mismatch)', async () => {
    mocks.decodeJobCreatedFromReceipt.mockReturnValue({
      ...MATCHING_EVENT,
      hook: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' as `0x${string}`,
    });

    const res = await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error).toBe('event_hook_mismatch');
    expect(data.ok).toBe(false);
  });

  it('rejected hook mismatch does not create local job', async () => {
    mocks.decodeJobCreatedFromReceipt.mockReturnValue({
      ...MATCHING_EVENT,
      hook: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' as `0x${string}`,
    });

    await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));

    expect(mocks.createLocalErc8183Job).not.toHaveBeenCalled();
  });

  it('rejected hook mismatch marks preparation as failed', async () => {
    mocks.decodeJobCreatedFromReceipt.mockReturnValue({
      ...MATCHING_EVENT,
      hook: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' as `0x${string}`,
    });

    await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));

    expect(mocks.supabaseUpdate).toHaveBeenCalledWith({ status: 'failed' });
  });

  // ── Existing checks still work ────────────────────────────────────────

  it('provider mismatch still rejected (422 event_provider_mismatch)', async () => {
    mocks.decodeJobCreatedFromReceipt.mockReturnValue({
      ...MATCHING_EVENT,
      provider: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD' as `0x${string}`,
    });

    const res = await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error).toBe('event_provider_mismatch');
  });

  it('evaluator mismatch still rejected (422 event_evaluator_mismatch)', async () => {
    mocks.decodeJobCreatedFromReceipt.mockReturnValue({
      ...MATCHING_EVENT,
      evaluator: '0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE' as `0x${string}`,
    });

    const res = await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error).toBe('event_evaluator_mismatch');
  });

  it('tx sender mismatch rejected (422 tx_sender_mismatch)', async () => {
    mocks.readTransactionReceipt.mockResolvedValue({
      ...MOCK_RECEIPT,
      from: '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF' as `0x${string}`,
    });

    const res = await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error).toBe('tx_sender_mismatch');
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  it('JobCreated event not found returns 422', async () => {
    mocks.decodeJobCreatedFromReceipt.mockReturnValue(null);

    const res = await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));
    const data = await res.json();

    expect(res.status).toBe(422);
    expect(data.error).toBe('job_created_event_not_found');
  });

  it('tx not found returns 202 (retry)', async () => {
    mocks.readTransactionReceipt.mockResolvedValue(null);

    const res = await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));
    const data = await res.json();

    expect(res.status).toBe(202);
    expect(data.error).toBe('tx_not_found');
  });

  it('already claimed preparation returns 409', async () => {
    setupClaimConflict('creating');

    const res = await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: TX_HASH }));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe('already_created_or_in_progress');
  });

  it('missing prepareId returns 400', async () => {
    const res = await POST(makeCreatedRequest({ createTxHash: TX_HASH }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('missing_prepareId');
  });

  it('invalid tx hash returns 400', async () => {
    const res = await POST(makeCreatedRequest({ prepareId: PREPARE_ID, createTxHash: 'not-a-hash' }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('invalid_tx_hash');
  });

  it('null body returns 400 invalid_body', async () => {
    const req = new NextRequest('http://localhost/api/erc8183-jobs/web-hire/created', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('invalid_body');
  });
});
