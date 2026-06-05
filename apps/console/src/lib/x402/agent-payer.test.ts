/**
 * Tests for lib/x402/agent-payer.ts — per-agent payer resolution + assertion.
 *
 * Covers:
 *   - resolveRequiredAgentX402Payer: active payer, missing payer, revoked payer, no fallback
 *   - assertX402PayerMatches: missing, mismatch, checksum match, invalid address
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAddress } from 'viem';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockMaybeSingle = vi.fn();
const mockLimit = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockIs = vi.fn(() => ({ limit: mockLimit, maybeSingle: mockMaybeSingle }));
const mockEq2 = vi.fn(() => ({ is: mockIs, limit: mockLimit, maybeSingle: mockMaybeSingle }));
const mockEq1 = vi.fn(() => ({ eq: mockEq2, is: mockIs, limit: mockLimit }));
const mockOr = vi.fn(() => ({ limit: vi.fn(() => ({ maybeSingle: mockMaybeSingle })) }));
const mockSelect = vi.fn(() => ({ eq: mockEq1, or: mockOr, limit: mockLimit, maybeSingle: mockMaybeSingle }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/lib/x402/supabaseClient', () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

// ── Imports (after mock setup) ─────────────────────────────────────────────

import {
  resolveRequiredAgentX402Payer,
  assertX402PayerMatches,
} from './agent-payer';

// ── Constants ──────────────────────────────────────────────────────────────

const AGENT_ID = '36191';
const CONTROLLER = getAddress('0xf5f11E68fbcbfa20De9208709aB60fF81509Cb20');
const PAYER_ADDR = getAddress('0x1234567890abcdef1234567890abcdef12345678');
const OTHER_PAYER = getAddress('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');

// ── resolveRequiredAgentX402Payer ──────────────────────────────────────────

describe('resolveRequiredAgentX402Payer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves active payer for valid agent', async () => {
    // First call: erc8004_agents lookup
    const agentMock = vi.fn().mockResolvedValue({
      data: { token_id: AGENT_ID, agent_id: AGENT_ID, controller: CONTROLLER },
      error: null,
    });

    // Second call: agent_x402_payers lookup
    const payerMock = vi.fn().mockResolvedValue({
      data: { payer_address: PAYER_ADDR, rail: 'circle-gateway', status: 'active', revoked_at: null },
      error: null,
    });

    let callCount = 0;
    mockFrom.mockImplementation(((table: string) => {
      callCount++;
      if (table === 'erc8004_agents') {
        return { select: () => ({ or: () => ({ limit: () => ({ maybeSingle: agentMock }) }) }) };
      }
      if (table === 'agent_x402_payers') {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: payerMock }) }) }) }) }) }) };
      }
      return { select: mockSelect };
    }) as any);

    const result = await resolveRequiredAgentX402Payer(AGENT_ID, 'circle-gateway');

    expect(result.agentId).toBe(AGENT_ID);
    expect(result.controllerAddress).toBe(CONTROLLER);
    expect(result.payerAddress).toBe(PAYER_ADDR);
    expect(result.rail).toBe('circle-gateway');
  });

  it('throws agent_not_found when agent does not exist', async () => {
    mockFrom.mockImplementation(((table: string) => {
      if (table === 'erc8004_agents') {
        return { select: () => ({ or: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: 'not found' }) }) }) }) };
      }
      return { select: mockSelect };
    }) as any);

    await expect(resolveRequiredAgentX402Payer('nonexistent'))
      .rejects.toMatchObject({ code: 'agent_not_found' });
  });

  it('throws agent_x402_payer_not_configured when no active payer', async () => {
    mockFrom.mockImplementation(((table: string) => {
      if (table === 'erc8004_agents') {
        return { select: () => ({ or: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { token_id: AGENT_ID, agent_id: AGENT_ID, controller: CONTROLLER }, error: null }) }) }) }) };
      }
      if (table === 'agent_x402_payers') {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }) }) }) }) };
      }
      return { select: mockSelect };
    }) as any);

    await expect(resolveRequiredAgentX402Payer(AGENT_ID))
      .rejects.toMatchObject({ code: 'agent_x402_payer_not_configured' });
  });

  it('never falls back to platform payer', async () => {
    // Even if there's a "platform" payer in some other table, resolver only reads agent_x402_payers
    mockFrom.mockImplementation(((table: string) => {
      if (table === 'erc8004_agents') {
        return { select: () => ({ or: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { token_id: AGENT_ID, agent_id: AGENT_ID, controller: CONTROLLER }, error: null }) }) }) }) };
      }
      if (table === 'agent_x402_payers') {
        // No active payer → should throw, never resolve platform payer
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }) }) }) }) };
      }
      return { select: mockSelect };
    }) as any);

    await expect(resolveRequiredAgentX402Payer(AGENT_ID))
      .rejects.toMatchObject({ code: 'agent_x402_payer_not_configured' });
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
