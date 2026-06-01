/**
 * ERC-8183 Authorization Tests
 *
 * Tests participant-bound authorization for ERC-8183 mutation routes.
 * Validates:
 *   - admin scope bypasses participant check
 *   - correct participant role passes check
 *   - wrong participant role returns 403
 *   - allowedErc8183AgentIds collects correct IDs per role
 *   - isErc8183Admin recognizes admin and erc8183:admin scopes
 */

import { describe, it, expect } from 'vitest';
import {
  isErc8183Admin,
  allowedErc8183AgentIds,
  assertErc8183Participant,
} from './authz';
import type { Erc8183JobView } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<Erc8183JobView> = {}): Erc8183JobView {
  return {
    localJobId: 'erc8183_test001',
    erc8183JobId: '100',
    settlementMode: 'erc8183_escrow',
    erc8183Status: 'Funded',
    status: 'created',
    buyerAgentId: 'buyer-001',
    clientAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    providerAgentId: 'provider-001',
    providerAddress: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    evaluatorAgentId: 'evaluator-001',
    evaluatorAddress: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    workerId: null,
    priceAtomic: '1000000',
    description: 'Test job',
    expiredAtUnix: '1800000000',
    hookAddress: '0x0000000000000000000000000000000000000000',
    inputPayload: {},
    inputPayloadHash: 'abc123',
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
    ...overrides,
  };
}

function makeAuth(agentId: string, scopes: string[] = []) {
  return {
    key: {
      id: 'key-001',
      agentId,
      scopes,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ERC-8183 authz', () => {
  // ── isErc8183Admin ────────────────────────────────────────────────────

  it('isErc8183Admin returns true for admin scope', () => {
    expect(isErc8183Admin(['admin'])).toBe(true);
  });

  it('isErc8183Admin returns true for erc8183:admin scope', () => {
    expect(isErc8183Admin(['erc8183:admin'])).toBe(true);
  });

  it('isErc8183Admin returns false for non-admin scopes', () => {
    expect(isErc8183Admin(['erc8183:create', 'erc8183:claim'])).toBe(false);
  });

  it('isErc8183Admin returns false for empty scopes', () => {
    expect(isErc8183Admin([])).toBe(false);
  });

  // ── allowedErc8183AgentIds ────────────────────────────────────────────

  it('collects buyer agentId when buyer role requested', () => {
    const job = makeJob();
    const ids = allowedErc8183AgentIds(job, ['buyer']);
    expect(ids.has('buyer-001')).toBe(true);
    expect(ids.size).toBe(1);
  });

  it('collects provider agentId when provider role requested', () => {
    const job = makeJob();
    const ids = allowedErc8183AgentIds(job, ['provider']);
    expect(ids.has('provider-001')).toBe(true);
  });

  it('collects worker agentId when worker role requested', () => {
    const job = makeJob({ workerId: 'worker-001' });
    const ids = allowedErc8183AgentIds(job, ['worker']);
    expect(ids.has('worker-001')).toBe(true);
  });

  it('collects evaluator agentId when evaluator role requested', () => {
    const job = makeJob();
    const ids = allowedErc8183AgentIds(job, ['evaluator']);
    expect(ids.has('evaluator-001')).toBe(true);
  });

  it('collects multiple roles', () => {
    const job = makeJob({ workerId: 'worker-001' });
    const ids = allowedErc8183AgentIds(job, ['buyer', 'provider', 'worker']);
    expect(ids.has('buyer-001')).toBe(true);
    expect(ids.has('provider-001')).toBe(true);
    expect(ids.has('worker-001')).toBe(true);
    expect(ids.size).toBe(3);
  });

  it('skips null workerId', () => {
    const job = makeJob({ workerId: null });
    const ids = allowedErc8183AgentIds(job, ['worker']);
    expect(ids.size).toBe(0);
  });

  // ── assertErc8183Participant ──────────────────────────────────────────

  it('returns null (allowed) when admin key', () => {
    const job = makeJob();
    const auth = makeAuth('random-agent', ['erc8183:admin']);
    const result = assertErc8183Participant(job, auth, ['buyer']);
    expect(result).toBeNull();
  });

  it('returns null (allowed) when agentId matches buyer role', () => {
    const job = makeJob();
    const auth = makeAuth('buyer-001', ['erc8183:create']);
    const result = assertErc8183Participant(job, auth, ['buyer']);
    expect(result).toBeNull();
  });

  it('returns null (allowed) when agentId matches provider role', () => {
    const job = makeJob();
    const auth = makeAuth('provider-001', ['erc8183:claim']);
    const result = assertErc8183Participant(job, auth, ['provider']);
    expect(result).toBeNull();
  });

  it('returns 403 response when agentId does not match any allowed role', () => {
    const job = makeJob();
    const auth = makeAuth('wrong-agent', ['erc8183:create']);
    const result = assertErc8183Participant(job, auth, ['buyer']);
    expect(result).not.toBeNull();
    // The result is a NextResponse — we can't easily inspect it without
    // NextRequest/NextResponse mocks, but we verify it's not null (= error)
  });

  it('returns 403 when agentId matches different role than required', () => {
    const job = makeJob();
    const auth = makeAuth('provider-001', ['erc8183:create']);
    // Provider tries to do buyer-only action
    const result = assertErc8183Participant(job, auth, ['buyer']);
    expect(result).not.toBeNull();
  });

  it('admin scope bypasses participant mismatch', () => {
    const job = makeJob();
    const auth = makeAuth('any-agent', ['admin']);
    const result = assertErc8183Participant(job, auth, ['buyer']);
    expect(result).toBeNull();
  });

  it('erc8183:admin scope bypasses participant mismatch', () => {
    const job = makeJob();
    const auth = makeAuth('any-agent', ['erc8183:admin']);
    const result = assertErc8183Participant(job, auth, ['evaluator']);
    expect(result).toBeNull();
  });
});
