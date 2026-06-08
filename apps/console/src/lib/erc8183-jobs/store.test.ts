/**
 * ERC-8183 Escrow Job Store Tests
 *
 * Tests the local mirror store operations for ERC-8183 escrow jobs.
 * Validates:
 *   - createLocalErc8183Job creates local mirror with correct fields
 *   - inputPayloadHash is deterministic (same input → same hash)
 *   - settlement_mode always = 'erc8183_escrow'
 *   - getErc8183JobByLocalId returns correct shape
 *   - Tx hash immutability guards (conflict + idempotent)
 *   - claimErc8183Job state machine guards
 *   - markErc8183JobRunning state machine guards
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// ── In-memory Supabase mock ───────────────────────────────────────────────

interface AgentJobRow {
  job_id: string;
  job_type: string;
  settlement_mode: string;
  status: string;
  buyer_agent_id: string;
  provider_agent_id: string | null;
  client_address: string | null;
  provider_address: string | null;
  evaluator_agent_id: string | null;
  evaluator_address: string | null;
  worker_id: string | null;
  price_atomic: string;
  description: string | null;
  expired_at_unix: string | null;
  hook_address: string | null;
  asset: string;
  chain_id: string;
  input_payload: unknown;
  input_payload_hash: string;
  result_payload: unknown | null;
  result_payload_hash: string | null;
  proof_payload: unknown | null;
  proof_payload_hash: string | null;
  deliverable_hash: string | null;
  reason_hash: string | null;
  create_tx_hash: string | null;
  erc8183_job_id: string | null;
  erc8183_status: string | null;
  set_budget_tx_hash: string | null;
  approve_tx_hash: string | null;
  fund_tx_hash: string | null;
  submit_tx_hash: string | null;
  complete_tx_hash: string | null;
  reject_tx_hash: string | null;
  rejected_at: string | null;
  reject_reason_text: string | null;
  reject_reason_hash: string | null;
  created_at: string;
  claimed_at: string | null;
  started_at: string | null;
  claim_expires_at: string | null;
  submitted_at: string | null;
  settled_at: string | null;
}

interface EventRow {
  job_id: string;
  event_type: string;
  actor_agent_id: string;
  status_before: string | null;
  status_after: string;
  payload_hash: string;
  metadata: unknown;
}

let jobRows: AgentJobRow[] = [];
let eventRows: EventRow[] = [];

function applyJobFilters(
  rows: AgentJobRow[],
  filters: Array<{ op: string; col: string; val: unknown }>,
) {
  return rows.filter((row) =>
    filters.every((f) => {
      const v = ((row as unknown) as Record<string, unknown>)[f.col];
      if (f.op === 'eq') return v === f.val;
      if (f.op === 'is') return f.val === null ? v === null : v !== null;
      if (f.op === 'in') return (f.val as unknown[]).includes(v);
      return true;
    }),
  );
}

const fakeSupabase = {
  from: (table: string) => {
    if (table === 'agent_job_events') {
      return {
        insert: (row: EventRow) => {
          eventRows.push(row);
          return Promise.resolve({ data: null, error: null });
        },
      };
    }

    if (table !== 'agent_jobs') {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      insert: (row: Record<string, unknown>) => {
        const fullRow: AgentJobRow = {
          ...row,
          created_at: new Date().toISOString(),
          claimed_at: null,
          started_at: null,
          claim_expires_at: null,
          submitted_at: null,
          settled_at: null,
          result_payload: null,
          result_payload_hash: null,
          proof_payload: null,
          proof_payload_hash: null,
          deliverable_hash: null,
          reason_hash: null,
          create_tx_hash: null,
          erc8183_job_id: null,
          erc8183_status: null,
          set_budget_tx_hash: null,
          approve_tx_hash: null,
          fund_tx_hash: null,
          submit_tx_hash: null,
          complete_tx_hash: null,
          reject_tx_hash: null,
          rejected_at: null,
          reject_reason_text: null,
          reject_reason_hash: null,
          worker_id: null,
          provider_agent_id: row.provider_agent_id as string ?? null,
          evaluator_agent_id: row.evaluator_agent_id as string ?? null,
          evaluator_address: row.evaluator_address as string ?? null,
          provider_address: row.provider_address as string ?? null,
          client_address: row.client_address as string ?? null,
        } as unknown as AgentJobRow;
        jobRows.push(fullRow as AgentJobRow);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: fullRow, error: null }),
          }),
        };
      },

      select: (columns?: string) => {
        const filters: Array<{ op: string; col: string; val: unknown }> = [];
        const query: Record<string, unknown> = {
          eq: (col: string, val: unknown) => {
            filters.push({ op: 'eq', col, val });
            return query;
          },
          is: (col: string, val: unknown) => {
            filters.push({ op: 'is', col, val });
            return query;
          },
          in: (col: string, val: unknown[]) => {
            filters.push({ op: 'in', col, val });
            return query;
          },
          single: () => {
            const found = applyJobFilters(jobRows, filters)[0] ?? null;
            if (!found) {
              return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'not found' } });
            }
            return Promise.resolve({ data: found, error: null });
          },
          order: () => query,
          limit: () => query,
          range: () => query,
          then: (resolve: (value: { data: AgentJobRow[]; error: null }) => void) => {
            resolve({ data: applyJobFilters(jobRows, filters), error: null });
          },
        };
        return query;
      },

      update: (patch: Record<string, unknown>) => {
        const filters: Array<{ op: string; col: string; val: unknown }> = [];
        const query: Record<string, unknown> = {
          eq: (col: string, val: unknown) => {
            filters.push({ op: 'eq', col, val });
            return query;
          },
          is: (col: string, val: unknown) => {
            filters.push({ op: 'is', col, val });
            return query;
          },
          in: (col: string, val: unknown[]) => {
            filters.push({ op: 'in', col, val });
            return query;
          },
          select: (selCol: string) => {
            // After select, resolve with matched rows
            const matched = applyJobFilters(jobRows, filters);
            // Apply the update
            jobRows = jobRows.map((row) => {
              const matches = filters.every((f) => {
                const v = ((row as unknown) as Record<string, unknown>)[f.col];
                if (f.op === 'eq') return v === f.val;
                if (f.op === 'is') return f.val === null ? v === null : v !== null;
                if (f.op === 'in') return (f.val as unknown[]).includes(v);
                return true;
              });
              return matches ? ({ ...row, ...patch } as unknown as AgentJobRow) : row;
            });
            const updated = applyJobFilters(jobRows, [{ op: 'eq', col: selCol, val: patch[selCol] ?? null }]);
            // Return the matched rows (before update) as "updated"
            return {
              then: (resolve: (value: { data: AgentJobRow[] | null; error: null }) => void) => {
                resolve({ data: matched.length > 0 ? matched : null, error: null });
              },
            };
          },
          then: (resolve: (value: { data: null; error: null }) => void) => {
            jobRows = jobRows.map((row) => {
              const matches = filters.every((f) => {
                const v = ((row as unknown) as Record<string, unknown>)[f.col];
                if (f.op === 'eq') return v === f.val;
                if (f.op === 'is') return f.val === null ? v === null : v !== null;
                if (f.op === 'in') return (f.val as unknown[]).includes(v);
                return true;
              });
              return matches ? { ...row, ...patch } : row;
            });
            resolve({ data: null, error: null });
          },
        };
        return query;
      },
    };
  },
};

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => fakeSupabase,
}));

import {
  createLocalErc8183Job,
  getErc8183JobByLocalId,
  getErc8183JobByOnchainId,
  claimErc8183Job,
  markErc8183JobRunning,
  attachErc8183RejectTx,
  Erc8183TxHashConflictError,
  Erc8183TxHashIdempotentError,
} from './store';
import type { CreateErc8183JobInput } from './types';

// ── Test helper to simulate fund/status updates ───────────────────────────

async function simulateDbUpdate(jobId: string, patch: Record<string, unknown>) {
  jobRows = jobRows.map((row) => {
    if (row.job_id === jobId) return { ...row, ...patch } as unknown as AgentJobRow;
    return row;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

const SAMPLE_INPUT: CreateErc8183JobInput = {
  buyerAgentId: 'buyer-001',
  clientAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  providerAgentId: 'provider-001',
  providerAddress: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  evaluatorAgentId: 'evaluator-001',
  evaluatorAddress: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
  expiredAtUnix: '1800000000',
  description: 'Test ERC-8183 job',
  hookAddress: '0x0000000000000000000000000000000000000000',
  budgetAtomic: '1000000',
  inputPayload: { task: 'analyze', data: [1, 2, 3] },
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ERC-8183 store', () => {
  beforeEach(() => {
    jobRows = [];
    eventRows = [];
  });

  // ── Create ────────────────────────────────────────────────────────────

  it('createLocalErc8183Job returns a valid Erc8183JobView', async () => {
    const job = await createLocalErc8183Job(SAMPLE_INPUT);

    expect(job.localJobId).toMatch(/^erc8183_[a-f0-9]{16}$/);
    expect(job.settlementMode).toBe('erc8183_escrow');
    expect(job.status).toBe('created');
    expect(job.buyerAgentId).toBe('buyer-001');
    expect(job.clientAddress).toBe(SAMPLE_INPUT.clientAddress);
    expect(job.providerAgentId).toBe('provider-001');
    expect(job.providerAddress).toBe(SAMPLE_INPUT.providerAddress);
    expect(job.evaluatorAgentId).toBe('evaluator-001');
    expect(job.priceAtomic).toBe('1000000');
    expect(job.description).toBe('Test ERC-8183 job');
    expect(job.expiredAtUnix).toBe('1800000000');
    expect(job.inputPayload).toEqual({ task: 'analyze', data: [1, 2, 3] });
  });

  it('createLocalErc8183Job sets settlement_mode = erc8183_escrow in DB', async () => {
    await createLocalErc8183Job(SAMPLE_INPUT);
    expect(jobRows[0]?.settlement_mode).toBe('erc8183_escrow');
    expect(jobRows[0]?.job_type).toBe('erc8183_escrow');
  });

  it('createLocalErc8183Job computes deterministic inputPayloadHash', async () => {
    const job1 = await createLocalErc8183Job(SAMPLE_INPUT);
    const job2 = await createLocalErc8183Job(SAMPLE_INPUT);

    // Same input → same hash
    expect(job1.inputPayloadHash).toBe(job2.inputPayloadHash);
    expect(job1.inputPayloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('createLocalErc8183Job computes different hash for different payloads', async () => {
    const job1 = await createLocalErc8183Job(SAMPLE_INPUT);
    const job2 = await createLocalErc8183Job({
      ...SAMPLE_INPUT,
      inputPayload: { task: 'different', data: [4, 5, 6] },
    });

    expect(job1.inputPayloadHash).not.toBe(job2.inputPayloadHash);
  });

  it('createLocalErc8183Job inserts a created event', async () => {
    await createLocalErc8183Job(SAMPLE_INPUT);

    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]?.event_type).toBe('created');
    expect(eventRows[0]?.actor_agent_id).toBe('buyer-001');
    expect(eventRows[0]?.status_before).toBeNull();
    expect(eventRows[0]?.status_after).toBe('created');
  });

  it('createLocalErc8183Job handles optional evaluator fields', async () => {
    const input: CreateErc8183JobInput = {
      ...SAMPLE_INPUT,
      evaluatorAgentId: undefined,
      evaluatorAddress: undefined,
    };

    const job = await createLocalErc8183Job(input);
    expect(job.evaluatorAgentId).toBeNull();
    expect(job.evaluatorAddress).toBeNull();
  });

  // ── Read ──────────────────────────────────────────────────────────────

  it('getErc8183JobByLocalId returns job after create', async () => {
    const created = await createLocalErc8183Job(SAMPLE_INPUT);
    const fetched = await getErc8183JobByLocalId(created.localJobId);

    expect(fetched).not.toBeNull();
    expect(fetched?.localJobId).toBe(created.localJobId);
    expect(fetched?.buyerAgentId).toBe('buyer-001');
    expect(fetched?.inputPayloadHash).toBe(created.inputPayloadHash);
  });

  it('getErc8183JobByLocalId returns null for non-existent job', async () => {
    const fetched = await getErc8183JobByLocalId('erc8183_nonexistent');
    expect(fetched).toBeNull();
  });

  // ── Tx hash immutability guard ────────────────────────────────────────

  it('Erc8183TxHashConflictError has correct code and fields', () => {
    const err = new Erc8183TxHashConflictError('set_budget_tx_hash', '0xold', '0xnew');
    expect(err.code).toBe('TX_HASH_CONFLICT');
    expect(err.fieldName).toBe('set_budget_tx_hash');
    expect(err.existingTxHash).toBe('0xold');
    expect(err.nextTxHash).toBe('0xnew');
    expect(err.message).toContain('set_budget_tx_hash');
    expect(err.message).toContain('already attached');
  });

  it('Erc8183TxHashIdempotentError has correct code and fields', () => {
    const err = new Erc8183TxHashIdempotentError('fund_tx_hash', '0xsame');
    expect(err.code).toBe('IDEMPOTENT_TX');
    expect(err.fieldName).toBe('fund_tx_hash');
    expect(err.existingTxHash).toBe('0xsame');
  });

  // ── Claim state machine ───────────────────────────────────────────────

  it('claimErc8183Job succeeds when erc8183_status=Funded and status=created', async () => {
    const job = await createLocalErc8183Job(SAMPLE_INPUT);

    // Simulate fund confirmation
    await simulateDbUpdate(job.localJobId, { erc8183_status: 'Funded' });

    await claimErc8183Job({
      localJobId: job.localJobId,
      workerId: 'worker-001',
      providerAgentId: 'provider-001',
    });

    const updated = await getErc8183JobByLocalId(job.localJobId);
    expect(updated?.status).toBe('claimed');
    expect(updated?.workerId).toBe('worker-001');
    expect(updated?.providerAgentId).toBe('provider-001');
    expect(updated?.claimedAt).not.toBeNull();
  });

  it('claimErc8183Job fails when status is not created', async () => {
    const job = await createLocalErc8183Job(SAMPLE_INPUT);

    // Simulate fund + claim
    await simulateDbUpdate(job.localJobId, { erc8183_status: 'Funded' });

    await claimErc8183Job({
      localJobId: job.localJobId,
      workerId: 'worker-001',
      providerAgentId: 'provider-001',
    });

    // Try to claim again — should fail because status is now 'claimed', not 'created'
    await expect(
      claimErc8183Job({
        localJobId: job.localJobId,
        workerId: 'worker-002',
        providerAgentId: 'provider-001',
      }),
    ).rejects.toThrow(/not_claimable/);
  });

  it('claimErc8183Job sets claim_expires_at with default TTL', async () => {
    const job = await createLocalErc8183Job(SAMPLE_INPUT);

    await simulateDbUpdate(job.localJobId, { erc8183_status: 'Funded' });

    const beforeClaim = Date.now();
    await claimErc8183Job({
      localJobId: job.localJobId,
      workerId: 'worker-001',
      providerAgentId: 'provider-001',
    });

    const updated = await getErc8183JobByLocalId(job.localJobId);
    expect(updated?.claimedAt).not.toBeNull();

    // Check DB row has claim_expires_at
    const dbRow = jobRows.find((r) => r.job_id === job.localJobId);
    expect(dbRow?.claim_expires_at).not.toBeNull();
  });

  // ── Running state machine ─────────────────────────────────────────────

  it('markErc8183JobRunning succeeds after claim by same worker', async () => {
    const job = await createLocalErc8183Job(SAMPLE_INPUT);

    await simulateDbUpdate(job.localJobId, { erc8183_status: 'Funded' });

    await claimErc8183Job({
      localJobId: job.localJobId,
      workerId: 'worker-001',
      providerAgentId: 'provider-001',
    });

    await markErc8183JobRunning({
      localJobId: job.localJobId,
      workerId: 'worker-001',
    });

    const updated = await getErc8183JobByLocalId(job.localJobId);
    expect(updated?.status).toBe('running');
    expect(updated?.startedAt).not.toBeNull();
  });

  it('markErc8183JobRunning fails when workerId does not match', async () => {
    const job = await createLocalErc8183Job(SAMPLE_INPUT);

    await simulateDbUpdate(job.localJobId, { erc8183_status: 'Funded' });

    await claimErc8183Job({
      localJobId: job.localJobId,
      workerId: 'worker-001',
      providerAgentId: 'provider-001',
    });

    await expect(
      markErc8183JobRunning({
        localJobId: job.localJobId,
        workerId: 'worker-999', // wrong worker
      }),
    ).rejects.toThrow(/not_running/);
  });

  it('markErc8183JobRunning fails when job is not claimed', async () => {
    const job = await createLocalErc8183Job(SAMPLE_INPUT);

    await expect(
      markErc8183JobRunning({
        localJobId: job.localJobId,
        workerId: 'worker-001',
      }),
    ).rejects.toThrow(/not_running/);
  });

  describe('attachErc8183RejectTx', () => {
    const rejectInput = (localJobId: string, rejectTxHash = '0xreject') => ({
      localJobId,
      rejectTxHash,
      rejectReasonText: 'rejected',
      rejectReasonHash: '0xreason',
    });

    for (const erc8183Status of ['Open', 'Funded', 'Submitted'] as const) {
      it(`works from ${erc8183Status}`, async () => {
        const job = await createLocalErc8183Job(SAMPLE_INPUT);
        await simulateDbUpdate(job.localJobId, { erc8183_status: erc8183Status });

        await attachErc8183RejectTx(rejectInput(job.localJobId));

        const row = jobRows.find((candidate) => candidate.job_id === job.localJobId);
        expect(row).toMatchObject({
          erc8183_status: 'Rejected',
          status: 'rejected',
          reject_tx_hash: '0xreject',
          reject_reason_text: 'rejected',
          reject_reason_hash: '0xreason',
        });
      });
    }

    it('does not overwrite Completed', async () => {
      const job = await createLocalErc8183Job(SAMPLE_INPUT);
      await simulateDbUpdate(job.localJobId, { erc8183_status: 'Completed', status: 'settled' });

      await expect(attachErc8183RejectTx(rejectInput(job.localJobId))).rejects.toBeInstanceOf(
        Erc8183TxHashConflictError,
      );

      const row = jobRows.find((candidate) => candidate.job_id === job.localJobId);
      expect(row?.erc8183_status).toBe('Completed');
      expect(row?.status).toBe('settled');
      expect(row?.reject_tx_hash).toBeNull();
    });

    it('is idempotent for the same reject tx hash', async () => {
      const job = await createLocalErc8183Job(SAMPLE_INPUT);
      await simulateDbUpdate(job.localJobId, { erc8183_status: 'Submitted' });

      await attachErc8183RejectTx(rejectInput(job.localJobId));
      await expect(attachErc8183RejectTx(rejectInput(job.localJobId))).resolves.toBeUndefined();
    });
  });
});
