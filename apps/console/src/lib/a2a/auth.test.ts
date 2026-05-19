import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory fake of a2a_api_keys table
type Row = {
  id: string;
  agent_id: string;
  key_hash: string;
  key_prefix: string;
  label: string | null;
  scopes: string[];
  created_by: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

let rows: Row[] = [];
let insertCount = 0;

const fakeSupabase = {
  from: () => ({
    insert: (row: Omit<Row, 'id' | 'last_used_at' | 'revoked_at'>) => {
      const id = `key-${++insertCount}`;
      rows.push({ ...row, id, last_used_at: null, revoked_at: null });
      return {
        select: () => ({
          single: () => Promise.resolve({ data: { id }, error: null }),
        }),
      };
    },
    select: () => ({
      eq: (col: string, val: string) => ({
        maybeSingle: () => {
          const found = rows.find((r) =>
            col === 'key_hash' ? r.key_hash === val : r.id === val,
          );
          return Promise.resolve({ data: found ?? null, error: null });
        },
        eq: (col2: string, val2: string) => ({
          then: (fn: (v: unknown) => void) => fn({ data: null, error: null }),
        }),
      }),
    }),
    update: (patch: Partial<Row>) => ({
      eq: (col: string, val: string) => ({
        eq: (col2: string, val2: string) => {
          const idx = rows.findIndex((r) => r.id === val && r.agent_id === val2);
          if (idx >= 0) Object.assign(rows[idx], patch);
          return Promise.resolve({ error: null });
        },
        then: (fn: (v: unknown) => void) => fn({ data: null, error: null }),
      }),
    }),
  }),
};

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => fakeSupabase,
}));

import { createApiKey, verifyApiKey, revokeApiKey, requireApiKey } from './auth';

describe('a2a/auth', () => {
  beforeEach(() => {
    rows = [];
    insertCount = 0;
  });

  it('createApiKey returns a key starting with ak_', async () => {
    const result = await createApiKey({ agentId: 'test-agent', createdBy: '0xabc' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.key).toMatch(/^ak_/);
    expect(result.keyPrefix).toMatch(/^ak_/);
    expect(result.id).toBe('key-1');
  });

  it('verifyApiKey returns key metadata for valid key', async () => {
    const created = await createApiKey({ agentId: 'agent-1', createdBy: '0xabc' });
    if (!created.ok) throw new Error('create failed');

    const verified = await verifyApiKey(created.key);
    expect(verified).not.toBeNull();
    expect(verified?.agentId).toBe('agent-1');
    expect(verified?.scopes).toContain('jobs:claim');
  });

  it('verifyApiKey returns null for invalid key', async () => {
    const verified = await verifyApiKey('ak_invalid_garbage');
    expect(verified).toBeNull();
  });

  it('verifyApiKey returns null for revoked key', async () => {
    const created = await createApiKey({ agentId: 'agent-2', createdBy: '0xabc' });
    if (!created.ok) throw new Error('create failed');

    await revokeApiKey(created.id, 'agent-2');
    const verified = await verifyApiKey(created.key);
    expect(verified).toBeNull();
  });

  it('requireApiKey returns 401 when no header', async () => {
    const req = new Request('http://localhost/test', { method: 'POST' }) as unknown;
    const result = await requireApiKey(req as any);
    expect(result.error).toBeDefined();
  });

  it('requireApiKey returns 403 for insufficient scope', async () => {
    const created = await createApiKey({
      agentId: 'agent-3',
      scopes: ['jobs:claim'],
      createdBy: '0xabc',
    });
    if (!created.ok) throw new Error('create failed');

    const req = new Request('http://localhost/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.key}` },
    }) as unknown;
    const result = await requireApiKey(req as any, 'admin:delete');
    expect(result.error).toBeDefined();
  });
});
