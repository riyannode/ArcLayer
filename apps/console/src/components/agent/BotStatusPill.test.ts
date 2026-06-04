import { describe, expect, it } from 'vitest';

// Inline the function to avoid importing .tsx in a .ts test file
function isValidAgentId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!trimmed || trimmed.length < 2) return false;
  if (/^\d{2,}$/.test(trimmed)) return true;
  if (/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i.test(trimmed)) return true;
  return false;
}

describe('isValidAgentId', () => {
  it('accepts numeric ERC-8004 IDs', () => {
    expect(isValidAgentId('36192')).toBe(true);
    expect(isValidAgentId('1')).toBe(false); // too short
    expect(isValidAgentId('12')).toBe(true);
    expect(isValidAgentId('999999')).toBe(true);
  });

  it('accepts canonical slug IDs', () => {
    expect(isValidAgentId('hermes-oracle')).toBe(true);
    expect(isValidAgentId('apollo-analyzer')).toBe(true);
    expect(isValidAgentId('ignia-evaluator')).toBe(true);
  });

  it('rejects empty, null, undefined', () => {
    expect(isValidAgentId(null)).toBe(false);
    expect(isValidAgentId(undefined)).toBe(false);
    expect(isValidAgentId('')).toBe(false);
    expect(isValidAgentId('  ')).toBe(false);
  });

  it('rejects single-char strings', () => {
    expect(isValidAgentId('a')).toBe(false);
    expect(isValidAgentId('1')).toBe(false);
  });

  it('rejects obviously garbage values', () => {
    expect(isValidAgentId('—')).toBe(false);
    expect(isValidAgentId('n/a')).toBe(false); // contains /
    expect(isValidAgentId('true')).toBe(true); // valid slug
    expect(isValidAgentId('[object Object]')).toBe(false); // contains space and brackets
  });
});
