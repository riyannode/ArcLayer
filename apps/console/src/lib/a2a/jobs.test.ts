import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory fake of the agent_jobs table — covers the small subset of
// supabase-js query builder methods used by jobs.ts.
type Row = Record<string, unknown>;
const rows = new Map<string, Row>();

function makeBuilder(table: string) {
  type Filter = { kind: 'eq' | 'or'; field?: string; value?: unknown; expr?: string };
  const filters: Filter[] = [];
  let order: { field: string; ascending: boolean } | null = null;
  let rangeBounds: { from: number; to: number } | null = null;
  let pendingInsert: Row | null = null;
  let pendingUpdate: Row | null = null;

  function applyFilters(list: Row[]): Row[] {
    let out = list;
    for (const f of filters) {
      if (f.kind === 'eq') {
        out = out.filter((r) => r[f.field as string] === f.value);
      } else if (f.kind === 'or' && f.expr) {
        // Parse "agent_id.eq.X,claimed_by.eq.Y" form
        const clauses = f.expr.split(',').map((c) => {
          const [field, _op, value] = c.split('.');
          return { field, value };
        });
        out = out.filter((r) => clauses.some((c) => r[c.field] === c.value));
      }
    }
    return out;
  }

  const builder: any = {
    _table: table,
    select(_cols?: string) {
      return builder;
    },
    insert(payload: Row) {
      pendingInsert = payload;
      return builder;
    },
    update(payload: Row) {
      pendingUpdate = payload;
      return builder;
    },
    eq(field: string, value: unknown) {
      filters.push({ kind: 'eq', field, value });
      return builder;
    },
    or(expr: string) {
      filters.push({ kind: 'or', expr });
      return builder;
    },
    order(field: string, opts?: { ascending?: boolean }) {
      order = { field, ascending: opts?.ascending ?? true };
      return builder;
    },
    range(from: number, to: number) {
      rangeBounds = { from, to };
      return builder;
    },
    maybeSingle() {
      const list = applyFilters(Array.from(rows.values()));
      return Promise.resolve({ data: list[0] ?? null, error: null });
    },
    single() {
      // For insert/update returning single row
      if (pendingInsert) {
        rows.set(pendingInsert.id as string, { ...pendingInsert });
        return Promise.resolve({ data: rows.get(pendingInsert.id as string)!, error: null });
      }
      if (pendingUpdate) {
        const list = applyFilters(Array.from(rows.values()));
        const target = list[0];
        if (!target) return Promise.resolve({ data: null, error: { message: 'not found' } });
        const merged = { ...target, ...pendingUpdate };
        rows.set(target.id as string, merged);
        return Promise.resolve({ data: merged, error: null });
      }
      const list = applyFilters(Array.from(rows.values()));
      return Promise.resolve({ data: list[0] ?? null, error: null });
    },
    then(resolve: (v: { data: Row[]; error: null }) => void) {
      // Awaitable list query (after select + filters + order + range)
      let list = applyFilters(Array.from(rows.values()));
      if (order) {
        const o = order;
        list = list.slice().sort((a, b) => {
          const av = a[o.field] as string;
          const bv = b[o.field] as string;
          return o.ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (rangeBounds) list = list.slice(rangeBounds.from, rangeBounds.to + 1);
      resolve({ data: list, error: null });
    },
  };
  return builder;
}

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => makeBuilder(table),
  }),
}));

import { createA2AJob, listA2AJobs, claimA2AJob, submitA2AJob, getA2AJob } from './jobs';

describe('A2A jobs store', () => {
  beforeEach(() => {
    rows.clear();
  });

  it('createA2AJob returns deterministic-shaped record with status open', async () => {
    const job = await createA2AJob({ title: 'Test', description: 'Desc', requester: '0xabc' });
    expect(job.id).toMatch(/^job_[0-9a-f]{16}$/);
    expect(job.status).toBe('open');
    expect(job.title).toBe('Test');
    expect(job.requester).toBe('0xabc');
  });

  it('createA2AJob produces unique IDs across calls (sequence-based)', async () => {
    const a = await createA2AJob({ title: 'A', description: 'a' });
    const b = await createA2AJob({ title: 'A', description: 'a' });
    expect(a.id).not.toBe(b.id);
  });

  it('listA2AJobs filters by status, category, roleId', async () => {
    await createA2AJob({ title: 'A', description: 'a', category: 'dev', roleId: 'r1' });
    await createA2AJob({ title: 'B', description: 'b', category: 'pm', roleId: 'r2' });
    expect(await listA2AJobs({ category: 'dev' })).toHaveLength(1);
    expect(await listA2AJobs({ roleId: 'r2' })).toHaveLength(1);
    expect(await listA2AJobs({ status: 'open' })).toHaveLength(2);
    expect(await listA2AJobs({ status: 'claimed' })).toHaveLength(0);
  });

  it('claimA2AJob locks job to first agent and rejects others', async () => {
    const job = await createA2AJob({ title: 'X', description: 'x' });
    const first = await claimA2AJob(job.id, 'agent-1');
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.job.status).toBe('claimed');

    const second = await claimA2AJob(job.id, 'agent-2');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe('job_already_claimed');

    // Idempotent for same agent
    const reclaim = await claimA2AJob(job.id, 'agent-1');
    expect(reclaim.ok).toBe(true);
  });

  it('claimA2AJob returns job_not_found for unknown id', async () => {
    const result = await claimA2AJob('job_nope', 'agent-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('job_not_found');
  });

  it('submitA2AJob requires the claiming agentId', async () => {
    const job = await createA2AJob({ title: 'Y', description: 'y' });
    await claimA2AJob(job.id, 'agent-1');
    const wrong = await submitA2AJob(job.id, { agentId: 'agent-2', output: 'x' });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toBe('agent_did_not_claim_job');

    const right = await submitA2AJob(job.id, { agentId: 'agent-1', output: 'done', proof: { type: 'signed_result' } });
    expect(right.ok).toBe(true);
    if (right.ok) {
      expect(right.job.status).toBe('submitted');
      expect(right.receipt.id).toMatch(/^receipt_[0-9a-f]{16}$/);
    }
  });

  it('submitA2AJob auto-claims if job is still open', async () => {
    const job = await createA2AJob({ title: 'Z', description: 'z' });
    const result = await submitA2AJob(job.id, { agentId: 'agent-9', output: 'done' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.status).toBe('submitted');
      expect(result.job.claimedBy).toBe('agent-9');
    }
  });

  it('getA2AJob returns null for missing id', async () => {
    expect(await getA2AJob('job_missing')).toBeNull();
  });
});
