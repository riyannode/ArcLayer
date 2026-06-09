/**
 * Tests for lib/x402/agent-payer.ts — per-agent payer resolution + assertion.
 *
 * Covers:
 *   - validateAgentId: empty, too long, injection chars, valid
 *   - resolveRequiredAgentX402Payer: active payer, missing payer, token_id fallback, no fallback
 *   - assertX402PayerMatches: missing, mismatch, checksum match, invalid address
 *   - full binding flow: resolve + assert + mismatch rejection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAddress } from 'viem';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Two-step query: agent_id first, token_id second. No .or().
const mockMaybeSingle = vi.fn();
const mockLimit = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockIs = vi.fn(() => ({ limit: mockLimit, maybeSingle: mockMaybeSingle }));
const mockEq2 = vi.fn(() => ({ is: mockIs, limit: mockLimit, maybeSingle: mockMaybeSingle }));
const mockEq1 = vi.fn(() => ({ eq: mockEq2, is: mockIs, limit: mockLimit }));
const mockSelect = vi.fn(() => ({ eq: mockEq1, limit: mockLimit, maybeSingle: mockMaybeSingle }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

// ── Imports (after mock setup) ─────────────────────────────────────────────

import {
  validateAgentId,
  resolveRequiredAgentX402Payer,
  assertX402PayerMatches,
} from './agent-payer';

// ── Constants ──────────────────────────────────────────────────────────────

const AGENT_ID = '36191';
const CONTROLLER = getAddress('0xf5f11E68fbcbfa20De9208709aB60fF81509Cb20');
const PAYER_ADDR = getAddress('0x1234567890abcdef1234567890abcdef12345678');
const OTHER_PAYER = getAddress('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');

// ── Helper: mock two-step agent lookup ─────────────────────────────────────

/**
 * Build a mock from() that implements the two-step agent query pattern:
 * 1. eq('agent_id', ...) → maybeSingle → agentRow (or null)
 * 2. eq('token_id', ...) → maybeSingle → agentRow (or null, if first was null)
 * 3. eq('agent_id', ...) for agent_x402_payers → payerRow
 */
function mockFromTwoStep(opts: {
  agentByAgentId: Record<string, unknown> | null;
  agentByTokenId?: Record<string, unknown> | null;
  payerRow: Record<string, unknown> | null;
  agentIdError?: string | null;
  tokenIdError?: string | null;
}) {
  return ((table: string) => {
    if (table === 'erc8004_agents') {
      return {
        select: () => ({
          eq: (_col: string, _val: string) => {
            // First query: agent_id lookup
            if (_col === 'agent_id') {
              if (opts.agentIdError) {
                return { limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: opts.agentIdError } }) }) };
              }
              if (opts.agentByAgentId) {
                return { limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: opts.agentByAgentId, error: null }) }) };
              }
              return { limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) };
            }
            // Second query: token_id fallback
            if (_col === 'token_id') {
              if (opts.tokenIdError) {
                return { limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: opts.tokenIdError } }) }) };
              }
              const fallback = opts.agentByTokenId ?? opts.agentByAgentId;
              return { limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: fallback, error: null }) }) };
            }
            return { limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) };
          },
        }),
      };
    }
    if (table === 'agent_x402_payers') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  is: () => ({
                    limit: () => ({
                      maybeSingle: vi.fn().mockResolvedValue({ data: opts.payerRow, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    }
    return { select: mockSelect };
  }) as any;
}

// ── validateAgentId ────────────────────────────────────────────────────────

describe('validateAgentId', () => {
  it('rejects empty string', () => {
    expect(() => validateAgentId('')).toThrow();
    try { validateAgentId(''); } catch (e) { expect((e as any).code).toBe('invalid_agent_id'); }
  });

  it('rejects null/undefined', () => {
    expect(() => validateAgentId(null as any)).toThrow();
    expect(() => validateAgentId(undefined as any)).toThrow();
  });

  it('rejects agentId exceeding 128 chars', () => {
    const longId = 'a'.repeat(129);
    expect(() => validateAgentId(longId)).toThrow();
    try { validateAgentId(longId); } catch (e) { expect((e as any).code).toBe('invalid_agent_id'); }
  });

  it('rejects agentId with injection chars (spaces, semicolons, dots)', () => {
    expect(() => validateAgentId('36191; DROP TABLE')).toThrow();
    expect(() => validateAgentId('agent_id.eq.foo')).toThrow();
    expect(() => validateAgentId('36191 OR 1=1')).toThrow();
  });

  it('accepts valid numeric agentId', () => {
    expect(() => validateAgentId('36191')).not.toThrow();
  });

  it('accepts valid agentId with hyphens and underscores', () => {
    expect(() => validateAgentId('agent_123-abc')).not.toThrow();
  });

  it('accepts agentId at exactly 128 chars', () => {
    const id128 = 'a'.repeat(128);
    expect(() => validateAgentId(id128)).not.toThrow();
  });
});

// ── resolveRequiredAgentX402Payer ──────────────────────────────────────────

describe('resolveRequiredAgentX402Payer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves active payer for valid agent (agent_id match)', async () => {
    mockFrom.mockImplementation(mockFromTwoStep({
      agentByAgentId: { token_id: AGENT_ID, agent_id: AGENT_ID, controller: CONTROLLER },
      payerRow: { payer_address: PAYER_ADDR, rail: 'circle-gateway', status: 'active', revoked_at: null },
    }));

    const result = await resolveRequiredAgentX402Payer(AGENT_ID, 'circle-gateway');

    expect(result.agentId).toBe(AGENT_ID);
    expect(result.controllerAddress).toBe(CONTROLLER);
    expect(result.payerAddress).toBe(PAYER_ADDR);
    expect(result.rail).toBe('circle-gateway');
  });

  it('falls back to token_id when agent_id not found', async () => {
    mockFrom.mockImplementation(mockFromTwoStep({
      agentByAgentId: null, // agent_id lookup returns null
      agentByTokenId: { token_id: AGENT_ID, agent_id: AGENT_ID, controller: CONTROLLER },
      payerRow: { payer_address: PAYER_ADDR, rail: 'circle-gateway', status: 'active', revoked_at: null },
    }));

    const result = await resolveRequiredAgentX402Payer(AGENT_ID, 'circle-gateway');

    expect(result.agentId).toBe(AGENT_ID);
    expect(result.payerAddress).toBe(PAYER_ADDR);
  });

  it('throws agent_not_found when agent does not exist', async () => {
    mockFrom.mockImplementation(mockFromTwoStep({
      agentByAgentId: null,
      agentByTokenId: null,
      payerRow: null,
    }));

    await expect(resolveRequiredAgentX402Payer('nonexistent'))
      .rejects.toMatchObject({ code: 'agent_not_found' });
  });

  it('throws agent_x402_payer_not_configured when no active payer', async () => {
    mockFrom.mockImplementation(mockFromTwoStep({
      agentByAgentId: { token_id: AGENT_ID, agent_id: AGENT_ID, controller: CONTROLLER },
      payerRow: null, // no active payer
    }));

    await expect(resolveRequiredAgentX402Payer(AGENT_ID))
      .rejects.toMatchObject({ code: 'agent_x402_payer_not_configured' });
  });

  it('throws invalid_agent_id for agentId with injection chars', async () => {
    await expect(resolveRequiredAgentX402Payer('36191; DROP TABLE'))
      .rejects.toMatchObject({ code: 'invalid_agent_id' });
  });

  it('throws invalid_agent_id for empty agentId', async () => {
    await expect(resolveRequiredAgentX402Payer(''))
      .rejects.toMatchObject({ code: 'invalid_agent_id' });
  });

  it('throws invalid_agent_id for agentId exceeding 128 chars', async () => {
    await expect(resolveRequiredAgentX402Payer('a'.repeat(129)))
      .rejects.toMatchObject({ code: 'invalid_agent_id' });
  });

  it('never falls back to platform payer', async () => {
    mockFrom.mockImplementation(mockFromTwoStep({
      agentByAgentId: { token_id: AGENT_ID, agent_id: AGENT_ID, controller: CONTROLLER },
      payerRow: null, // no active payer → should throw, never resolve platform payer
    }));

    await expect(resolveRequiredAgentX402Payer(AGENT_ID))
      .rejects.toMatchObject({ code: 'agent_x402_payer_not_configured' });
  });

  it('throws agent_lookup_failed on agent_id query error (no silent fallback)', async () => {
    mockFrom.mockImplementation(mockFromTwoStep({
      agentByAgentId: null,
      payerRow: null,
      agentIdError: 'connection timeout',
    }));

    await expect(resolveRequiredAgentX402Payer(AGENT_ID))
      .rejects.toMatchObject({ code: 'agent_lookup_failed' });
  });

  it('throws agent_lookup_failed on token_id fallback query error', async () => {
    mockFrom.mockImplementation(mockFromTwoStep({
      agentByAgentId: null, // agent_id returns null → triggers token_id fallback
      payerRow: null,
      tokenIdError: 'RLS policy violation',
    }));

    await expect(resolveRequiredAgentX402Payer(AGENT_ID))
      .rejects.toMatchObject({ code: 'agent_lookup_failed' });
  });

  it('throws agent_not_found only when both lookups succeed with null data', async () => {
    mockFrom.mockImplementation(mockFromTwoStep({
      agentByAgentId: null,
      agentByTokenId: null,
      payerRow: null,
      // No errors — both queries succeed but return null
    }));

    await expect(resolveRequiredAgentX402Payer('nonexistent'))
      .rejects.toMatchObject({ code: 'agent_not_found' });
  });

  it('defaults to homepage scope when scope not specified', async () => {
    const AGENT_ACCOUNT_ADDR = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    mockFrom.mockImplementation(mockFromTwoStep({
      agentByAgentId: { token_id: AGENT_ID, agent_id: AGENT_ID, controller: CONTROLLER },
      payerRow: { payer_address: PAYER_ADDR, rail: 'circle-gateway', scope: 'homepage', status: 'active', revoked_at: null },
    }));

    // No scope arg → defaults to 'homepage'
    const result = await resolveRequiredAgentX402Payer(AGENT_ID, 'circle-gateway');

    expect(result.payerAddress).toBe(PAYER_ADDR);
  });

  it('resolves a2a scope to Agent Account payer when explicitly requested', async () => {
    const AGENT_ACCOUNT_ADDR = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    // Mock returns Agent Account payer when scope=a2a is in the query chain
    mockFrom.mockImplementation(((table: string) => {
      if (table === 'erc8004_agents') {
        return {
          select: () => ({
            eq: (col: string) => {
              if (col === 'agent_id') {
                return { limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { token_id: AGENT_ID, agent_id: AGENT_ID, controller: CONTROLLER }, error: null }) }) };
              }
              return { limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) };
            },
          }),
        };
      }
      if (table === 'agent_x402_payers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    is: () => ({
                      limit: () => ({
                        maybeSingle: vi.fn().mockResolvedValue({
                          data: { payer_address: AGENT_ACCOUNT_ADDR, rail: 'circle-gateway', scope: 'a2a', status: 'active', revoked_at: null },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return { select: mockSelect };
    }) as any);

    const result = await resolveRequiredAgentX402Payer(AGENT_ID, 'circle-gateway', 'a2a');

    expect(result.payerAddress).toBe(AGENT_ACCOUNT_ADDR);
  });
});

// ── assertX402PayerMatches ─────────────────────────────────────────────────

describe('assertX402PayerMatches', () => {
  it('rejects missing actualPayer', () => {
    const result = assertX402PayerMatches({
      actualPayer: null,
      expectedPayer: PAYER_ADDR,
      agentId: AGENT_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('x402_payer_missing');
      expect(result.status).toBe(400);
    }
  });

  it('rejects empty string actualPayer', () => {
    const result = assertX402PayerMatches({
      actualPayer: '  ',
      expectedPayer: PAYER_ADDR,
      agentId: AGENT_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('x402_payer_missing');
    }
  });

  it('rejects mismatched payer', () => {
    const result = assertX402PayerMatches({
      actualPayer: OTHER_PAYER,
      expectedPayer: PAYER_ADDR,
      agentId: AGENT_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('x402_payer_mismatch');
      expect(result.status).toBe(403);
      expect(result.detail.actualPayer).toBe(OTHER_PAYER);
      expect(result.detail.expectedPayer).toBe(PAYER_ADDR);
    }
  });

  it('accepts matching payer (exact checksum)', () => {
    const result = assertX402PayerMatches({
      actualPayer: PAYER_ADDR,
      expectedPayer: PAYER_ADDR,
      agentId: AGENT_ID,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts matching payer (case-insensitive checksum)', () => {
    const result = assertX402PayerMatches({
      actualPayer: PAYER_ADDR.toLowerCase(),
      expectedPayer: PAYER_ADDR,
      agentId: AGENT_ID,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects invalid address format', () => {
    const result = assertX402PayerMatches({
      actualPayer: 'not-an-address',
      expectedPayer: PAYER_ADDR,
      agentId: AGENT_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('x402_payer_invalid_address');
    }
  });
});

// ── Full binding flow: resolve + assert + mismatch rejection ───────────────
// Simulates the middleware's agentPayerBinding path with wrong payer key.

describe('full binding flow: wrong payer rejects before settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves registered payer then rejects x402_payer_mismatch for wrong key', async () => {
    mockFrom.mockImplementation(mockFromTwoStep({
      agentByAgentId: { token_id: AGENT_ID, agent_id: AGENT_ID, controller: CONTROLLER },
      payerRow: { payer_address: PAYER_ADDR, rail: 'circle-gateway', status: 'active', revoked_at: null },
    }));

    // Step 1: Resolver finds registered payer
    const resolved = await resolveRequiredAgentX402Payer(AGENT_ID, 'circle-gateway');
    expect(resolved.payerAddress).toBe(PAYER_ADDR);
    expect(resolved.controllerAddress).toBe(CONTROLLER);

    // Step 2: Wrong payer pays (simulates bot with wrong private key)
    const wrongPayer = OTHER_PAYER;
    const matchResult = assertX402PayerMatches({
      actualPayer: wrongPayer,
      expectedPayer: resolved.payerAddress,
      agentId: resolved.agentId,
    });

    // Step 3: Must reject BEFORE settlement
    expect(matchResult.ok).toBe(false);
    if (!matchResult.ok) {
      expect(matchResult.error).toBe('x402_payer_mismatch');
      expect(matchResult.status).toBe(403);
      expect(matchResult.detail.expectedPayer).toBe(PAYER_ADDR);
      expect(matchResult.detail.actualPayer).toBe(OTHER_PAYER);
    }
  });

  it('resolves registered payer and accepts correct payer', async () => {
    mockFrom.mockImplementation(mockFromTwoStep({
      agentByAgentId: { token_id: AGENT_ID, agent_id: AGENT_ID, controller: CONTROLLER },
      payerRow: { payer_address: PAYER_ADDR, rail: 'circle-gateway', status: 'active', revoked_at: null },
    }));

    const resolved = await resolveRequiredAgentX402Payer(AGENT_ID, 'circle-gateway');

    // Correct payer (same EOA that's registered)
    const matchResult = assertX402PayerMatches({
      actualPayer: PAYER_ADDR,
      expectedPayer: resolved.payerAddress,
      agentId: resolved.agentId,
    });

    expect(matchResult.ok).toBe(true);
  });

  it('rejects missing payer before settlement (middleware path)', async () => {
    mockFrom.mockImplementation(mockFromTwoStep({
      agentByAgentId: { token_id: AGENT_ID, agent_id: AGENT_ID, controller: CONTROLLER },
      payerRow: { payer_address: PAYER_ADDR, rail: 'circle-gateway', status: 'active', revoked_at: null },
    }));

    const resolved = await resolveRequiredAgentX402Payer(AGENT_ID, 'circle-gateway');

    // No payer in payment proof (e.g. Gateway verify didn't return payer)
    const matchResult = assertX402PayerMatches({
      actualPayer: null,
      expectedPayer: resolved.payerAddress,
      agentId: resolved.agentId,
    });

    expect(matchResult.ok).toBe(false);
    if (!matchResult.ok) {
      expect(matchResult.error).toBe('x402_payer_missing');
      expect(matchResult.status).toBe(400);
    }
  });
});
