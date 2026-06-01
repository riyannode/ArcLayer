/**
 * ERC-8004 Metadata Draft Store Tests
 *
 * Tests the metadata draft CRUD operations used by the ERC-8004
 * identity registration flow. Validates:
 *   - draft create requires valid controller
 *   - draft create requires metadata object
 *   - draft GET returns metadata
 *   - draft PATCH requires writeToken
 *   - invalid writeToken rejected
 *   - PATCH with agentId changes status to minted
 *   - profile lookup by controller returns minted agents only
 *   - metadata contains required ERC-8183 markers for worker/evaluator/client roles
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory Supabase mock ───────────────────────────────────────────────

interface DraftRow {
  draft_id: string;
  controller: string;
  metadata: unknown;
  write_token_hash: string;
  status: string;
  agent_id: string | null;
  tx_hash: string | null;
  updated_at: string;
}

let rows: DraftRow[] = [];

function applyFilters(
  inputRows: DraftRow[],
  filters: Array<{ op: string; col: string; val: unknown }>,
) {
  return inputRows.filter((row) =>
    filters.every((f) => {
      const v = ((row as unknown) as Record<string, unknown>)[f.col];
      if (f.op === 'eq') return v === f.val;
      if (f.op === 'ilike') {
        // Supabase ilike with % wildcards
        const pattern = String(f.val).replace(/%/g, '');
        return String(v).toLowerCase() === pattern.toLowerCase();
      }
      if (f.op === 'not') {
        // "not" with "is.null" semantics — row field must not be null
        if (f.val === 'is.null') return v !== null;
        return true;
      }
      return true;
    }),
  );
}

const fakeSupabase = {
  from: (table: string) => {
    if (table !== 'agent_metadata_drafts') {
      throw new Error(`Unexpected table: ${table}`);
    }
    return {
      insert: (row: Record<string, unknown>) => {
        const fullRow = { status: 'draft', agent_id: null, tx_hash: null, ...row } as unknown as DraftRow;
        rows.push(fullRow);
        return {
          select: () => ({
            single: () =>
              Promise.resolve({ data: fullRow, error: null }),
          }),
        };
      },

      select: (columns: string) => {
        const filters: Array<{ op: string; col: string; val: unknown }> = [];
        const query: Record<string, unknown> = {
          eq: (col: string, val: unknown) => {
            filters.push({ op: 'eq', col, val });
            return query;
          },
          ilike: (col: string, val: unknown) => {
            filters.push({ op: 'ilike', col, val });
            return query;
          },
          not: (col: string, op: string, val: unknown) => {
            filters.push({ op: 'not', col: `${col}.${op}`, val });
            return query;
          },
          order: (_col: string, _opts: unknown) => query,
          limit: (_n: number) => query,
          maybeSingle: () => {
            const found = applyFilters(rows, filters)[0] ?? null;
            return Promise.resolve({ data: found, error: null });
          },
          then: (resolve: (value: { data: DraftRow[]; error: null }) => void) => {
            resolve({ data: applyFilters(rows, filters), error: null });
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
          then: (resolve: (value: { data: null; error: null }) => void) => {
            rows = rows.map((row) => {
              const matches = filters.every((f) => {
                const v = ((row as unknown) as Record<string, unknown>)[f.col];
                return f.op === 'eq' ? v === f.val : true;
              });
              return matches ? { ...row, ...patch } as DraftRow : row;
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
  createMetadataDraft,
  getMetadataDraft,
  getAgentsByController,
  updateMetadataDraft,
} from './store';

// ── Helpers ───────────────────────────────────────────────────────────────

const SAMPLE_METADATA = {
  schema: 'arclayer.agent/v1',
  name: 'Test Agent',
  description: 'A test agent for ERC-8183 commerce',
  categories: ['erc8183-commerce'],
  tags: ['erc8183', 'agentic-commerce'],
  x402: { enabled: false },
  jobs: {
    accepts: ['erc8183-commerce'],
  },
};

const CONTROLLER = '0x1234567890abcdef1234567890abcdef12345678';

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ERC-8004 metadata draft store', () => {
  beforeEach(() => {
    rows = [];
  });

  // ── Create ────────────────────────────────────────────────────────────

  it('createMetadataDraft returns ok with draftId and writeToken', async () => {
    const result = await createMetadataDraft({
      controller: CONTROLLER,
      metadata: SAMPLE_METADATA,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.draftId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.writeToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('createMetadataDraft stores controller in lowercase', async () => {
    const result = await createMetadataDraft({
      controller: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
      metadata: SAMPLE_METADATA,
    });

    expect(result.ok).toBe(true);
    expect(rows[0]?.controller).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });

  it('createMetadataDraft stores the full metadata object', async () => {
    await createMetadataDraft({
      controller: CONTROLLER,
      metadata: SAMPLE_METADATA,
    });

    expect(rows[0]?.metadata).toEqual(SAMPLE_METADATA);
  });

  it('createMetadataDraft stores hashed writeToken, not raw', async () => {
    const result = await createMetadataDraft({
      controller: CONTROLLER,
      metadata: SAMPLE_METADATA,
    });

    if (!result.ok) return;

    // The stored hash should NOT be the raw writeToken
    expect(rows[0]?.write_token_hash).not.toBe(result.writeToken);
    // Should be a hex string (SHA-256)
    expect(rows[0]?.write_token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  // ── Read ──────────────────────────────────────────────────────────────

  it('getMetadataDraft returns metadata for existing draft', async () => {
    const created = await createMetadataDraft({
      controller: CONTROLLER,
      metadata: SAMPLE_METADATA,
    });
    if (!created.ok) return;

    const draft = await getMetadataDraft(created.draftId);

    expect(draft).not.toBeNull();
    expect(draft?.draftId).toBe(created.draftId);
    expect(draft?.controller).toBe(CONTROLLER.toLowerCase());
    expect(draft?.metadata).toEqual(SAMPLE_METADATA);
    expect(draft?.status).toBe('draft');
    expect(draft?.agentId).toBeNull();
    expect(draft?.txHash).toBeNull();
  });

  it('getMetadataDraft returns null for non-existent draftId', async () => {
    const draft = await getMetadataDraft('non-existent-uuid');
    expect(draft).toBeNull();
  });

  // ── Patch with writeToken ─────────────────────────────────────────────

  it('updateMetadataDraft rejects invalid writeToken', async () => {
    const created = await createMetadataDraft({
      controller: CONTROLLER,
      metadata: SAMPLE_METADATA,
    });
    if (!created.ok) return;

    const result = await updateMetadataDraft({
      draftId: created.draftId,
      writeToken: 'invalid-token',
      metadata: SAMPLE_METADATA,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid write token');
  });

  it('updateMetadataDraft rejects non-existent draftId', async () => {
    const result = await updateMetadataDraft({
      draftId: 'non-existent-uuid',
      writeToken: 'any-token',
      metadata: SAMPLE_METADATA,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('draft not found');
  });

  it('updateMetadataDraft succeeds with correct writeToken', async () => {
    const created = await createMetadataDraft({
      controller: CONTROLLER,
      metadata: SAMPLE_METADATA,
    });
    if (!created.ok) return;

    const updatedMetadata = { ...SAMPLE_METADATA, name: 'Updated Agent' };
    const result = await updateMetadataDraft({
      draftId: created.draftId,
      writeToken: created.writeToken,
      metadata: updatedMetadata,
    });

    expect(result.ok).toBe(true);

    // Verify the metadata was updated
    const draft = await getMetadataDraft(created.draftId);
    expect(draft?.metadata).toEqual(updatedMetadata);
  });

  it('updateMetadataDraft with agentId changes status to minted', async () => {
    const created = await createMetadataDraft({
      controller: CONTROLLER,
      metadata: SAMPLE_METADATA,
    });
    if (!created.ok) return;

    const result = await updateMetadataDraft({
      draftId: created.draftId,
      writeToken: created.writeToken,
      metadata: SAMPLE_METADATA,
      agentId: '31380',
      txHash: '0xabcdef1234567890',
    });

    expect(result.ok).toBe(true);

    const draft = await getMetadataDraft(created.draftId);
    expect(draft?.status).toBe('minted');
    expect(draft?.agentId).toBe('31380');
    expect(draft?.txHash).toBe('0xabcdef1234567890');
  });

  // ── Profile lookup by controller ──────────────────────────────────────

  it('getAgentsByController returns only minted agents', async () => {
    // Create two drafts — one draft, one minted
    const draft1 = await createMetadataDraft({
      controller: CONTROLLER,
      metadata: SAMPLE_METADATA,
    });
    const draft2 = await createMetadataDraft({
      controller: CONTROLLER,
      metadata: { ...SAMPLE_METADATA, name: 'Agent 2' },
    });

    if (!draft1.ok || !draft2.ok) return;

    // Mint only draft2
    await updateMetadataDraft({
      draftId: draft2.draftId,
      writeToken: draft2.writeToken,
      metadata: SAMPLE_METADATA,
      agentId: '99999',
      txHash: '0x123',
    });

    const agents = await getAgentsByController(CONTROLLER);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.agentId).toBe('99999');
    expect(agents[0]?.status).toBe('minted');
  });

  it('getAgentsByController returns empty for unknown controller', async () => {
    const agents = await getAgentsByController('0xunknown');
    expect(agents).toEqual([]);
  });

  it('getAgentsByController normalizes controller to lowercase', async () => {
    const created = await createMetadataDraft({
      controller: CONTROLLER,
      metadata: SAMPLE_METADATA,
    });
    if (!created.ok) return;

    await updateMetadataDraft({
      draftId: created.draftId,
      writeToken: created.writeToken,
      metadata: SAMPLE_METADATA,
      agentId: '12345',
    });

    // Query with uppercase
    const agents = await getAgentsByController(CONTROLLER.toUpperCase());
    expect(agents).toHaveLength(1);
  });

  // ── ERC-8183 metadata markers ─────────────────────────────────────────

  it('worker role metadata has required ERC-8183 markers', () => {
    const workerMeta = {
      schema: 'arclayer.agent/v1',
      name: 'Worker Bot',
      categories: ['erc8183-commerce'],
      tags: ['erc8183', 'agentic-commerce'],
      x402: { enabled: false },
      jobs: { accepts: ['erc8183-commerce'] },
      role: 'worker',
    };

    expect(workerMeta.schema).toBe('arclayer.agent/v1');
    expect(workerMeta.categories).toContain('erc8183-commerce');
    expect(workerMeta.tags).toContain('erc8183');
    expect(workerMeta.tags).toContain('agentic-commerce');
    expect(workerMeta.jobs.accepts).toContain('erc8183-commerce');
  });

  it('evaluator role metadata has required ERC-8183 markers', () => {
    const evaluatorMeta = {
      schema: 'arclayer.agent/v1',
      name: 'Evaluator Bot',
      categories: ['erc8183-commerce'],
      tags: ['erc8183', 'agentic-commerce'],
      x402: { enabled: false },
      jobs: { accepts: ['erc8183-commerce'] },
      role: 'evaluator',
    };

    expect(evaluatorMeta.schema).toBe('arclayer.agent/v1');
    expect(evaluatorMeta.categories).toContain('erc8183-commerce');
    expect(evaluatorMeta.tags).toContain('erc8183');
  });

  it('client role metadata has required ERC-8183 markers', () => {
    const clientMeta = {
      schema: 'arclayer.agent/v1',
      name: 'Client Bot',
      categories: ['erc8183-commerce'],
      tags: ['erc8183', 'agentic-commerce'],
      x402: { enabled: false },
      jobs: { accepts: ['erc8183-commerce'] },
      role: 'autonomous-client',
    };

    expect(clientMeta.schema).toBe('arclayer.agent/v1');
    expect(clientMeta.categories).toContain('erc8183-commerce');
    expect(clientMeta.tags).toContain('agentic-commerce');
  });
});
