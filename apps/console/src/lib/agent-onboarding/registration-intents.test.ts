import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intent-1',
    mcp_session_id: 'session-1',
    owner_address: '0xowner',
    draft_id: 'draft-1',
    role_preset_id: 'provider',
    status: 'draft',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    completed_at: null,
    agent_id: null,
    tx_hash: null,
    ...overrides,
  };
}

function mockSupabase(input: { updateData?: Record<string, unknown> | null; currentData?: Record<string, unknown> | null }) {
  const eqCalls: Array<[string, unknown]> = [];
  const updateChain = {
    eq(key: string, value: unknown) {
      eqCalls.push([key, value]);
      return updateChain;
    },
    select() {
      return updateChain;
    },
    maybeSingle: vi.fn(async () => ({ data: input.updateData ?? null, error: null })),
  };

  const selectChain = {
    eq(key: string, value: unknown) {
      eqCalls.push([key, value]);
      return selectChain;
    },
    maybeSingle: vi.fn(async () => ({ data: input.currentData ?? null, error: null })),
  };

  const table = {
    update: vi.fn(() => updateChain),
    select: vi.fn(() => selectChain),
  };

  mocks.getSupabaseAdmin.mockReturnValue({ from: vi.fn(() => table) });
  return { eqCalls, table, updateChain, selectChain };
}

describe('completeRegistrationIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only completes draft rows by id', async () => {
    const { completeRegistrationIntent } = await import('./registration-intents');
    const supabase = mockSupabase({
      updateData: row({ status: 'completed', agent_id: '123', tx_hash: '0x' + '1'.repeat(64) }),
    });

    const result = await completeRegistrationIntent({ id: 'intent-1', agentId: '123', txHash: '0x' + '1'.repeat(64) });

    expect(result.ok).toBe(true);
    expect(supabase.eqCalls).toContainEqual(['id', 'intent-1']);
    expect(supabase.eqCalls).toContainEqual(['status', 'draft']);
  });

  it('returns idempotent when the intent is already completed with the same agentId and txHash', async () => {
    const { completeRegistrationIntent } = await import('./registration-intents');
    mockSupabase({
      updateData: null,
      currentData: row({ status: 'completed', agent_id: '123', tx_hash: '0x' + '1'.repeat(64), completed_at: new Date().toISOString() }),
    });

    const result = await completeRegistrationIntent({ id: 'intent-1', agentId: '123', txHash: '0x' + '1'.repeat(64) });

    expect(result).toMatchObject({ ok: true, idempotent: true });
  });

  it('returns conflict when the intent is already completed with different values', async () => {
    const { completeRegistrationIntent } = await import('./registration-intents');
    mockSupabase({
      updateData: null,
      currentData: row({ status: 'completed', agent_id: '999', tx_hash: '0x' + '2'.repeat(64), completed_at: new Date().toISOString() }),
    });

    const result = await completeRegistrationIntent({ id: 'intent-1', agentId: '123', txHash: '0x' + '1'.repeat(64) });

    expect(result).toMatchObject({ ok: false, conflict: true, error: 'intent_complete_conflict' });
  });
});
