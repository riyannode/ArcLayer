import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * useX402Access relies on React hooks (useState, useEffect) + wagmi/circleWallet hooks.
 * Without @testing-library/react we test the core logic directly:
 * sessionStorage key format and lookup.
 */

const RESOURCE = '/api/x402/protected-resource';

const store = new Map<string, string>();
const sessionStorage = {
  clear: () => store.clear(),
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
};

function checkAccess(address: string): { hasAccess: boolean; rail: string | null; txHash: string | null } {
  const rails = ['arc-native', 'circle-gateway'] as const;
  for (const rail of rails) {
    const key = `x402_paid:${rail}:${RESOURCE}:${address.toLowerCase()}`;
    const stored = sessionStorage.getItem(key);
    if (stored) {
      let txHash: string | null = null;
      try {
        const parsed = JSON.parse(stored);
        txHash = parsed.txHash || null;
      } catch { /* ignore */ }
      return { hasAccess: true, rail, txHash };
    }
  }
  return { hasAccess: false, rail: null, txHash: null };
}

describe('x402 access session check (core logic)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns hasAccess=false when no session exists', () => {
    const result = checkAccess('0x4aA3402575b6D98EacE35A823EFa267F7365bdD2');
    expect(result.hasAccess).toBe(false);
    expect(result.rail).toBeNull();
  });

  it('returns hasAccess=true for arc-native session', () => {
    const addr = '0x4aa3402575b6d98eace35a823efa267f7365bdd2';
    sessionStorage.setItem(
      `x402_paid:arc-native:${RESOURCE}:${addr}`,
      JSON.stringify({ txHash: '0xabc123', paidAt: Date.now() })
    );
    const result = checkAccess(addr);
    expect(result.hasAccess).toBe(true);
    expect(result.rail).toBe('arc-native');
    expect(result.txHash).toBe('0xabc123');
  });

  it('returns hasAccess=true for circle-gateway session', () => {
    const addr = '0x4aa3402575b6d98eace35a823efa267f7365bdd2';
    sessionStorage.setItem(
      `x402_paid:circle-gateway:${RESOURCE}:${addr}`,
      JSON.stringify({ txHash: '0xdef456', paidAt: Date.now() })
    );
    const result = checkAccess(addr);
    expect(result.hasAccess).toBe(true);
    expect(result.rail).toBe('circle-gateway');
    expect(result.txHash).toBe('0xdef456');
  });

  it('prefers arc-native over circle-gateway when both exist', () => {
    const addr = '0x4aa3402575b6d98eace35a823efa267f7365bdd2';
    sessionStorage.setItem(
      `x402_paid:arc-native:${RESOURCE}:${addr}`,
      JSON.stringify({ txHash: '0xfirst', paidAt: Date.now() })
    );
    sessionStorage.setItem(
      `x402_paid:circle-gateway:${RESOURCE}:${addr}`,
      JSON.stringify({ txHash: '0xsecond', paidAt: Date.now() })
    );
    const result = checkAccess(addr);
    expect(result.hasAccess).toBe(true);
    expect(result.rail).toBe('arc-native');
  });

  it('is case-insensitive on address', () => {
    sessionStorage.setItem(
      `x402_paid:arc-native:${RESOURCE}:0xabcdef`,
      JSON.stringify({ txHash: '0x999', paidAt: Date.now() })
    );
    const result = checkAccess('0xABCDEF');
    expect(result.hasAccess).toBe(true);
  });

  it('handles malformed JSON gracefully', () => {
    const addr = '0xtest';
    sessionStorage.setItem(`x402_paid:arc-native:${RESOURCE}:${addr}`, 'not-json');
    const result = checkAccess(addr);
    expect(result.hasAccess).toBe(true);
    expect(result.txHash).toBeNull();
  });
});
