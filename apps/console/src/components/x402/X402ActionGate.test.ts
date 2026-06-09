import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./X402ActionGate.tsx', import.meta.url), 'utf8');

describe('X402ActionGate locked interaction protection', () => {
  it('makes locked and loading child subtrees inert and hidden from accessibility navigation', () => {
    expect(source.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(source.match(/\binert\b/g)).toHaveLength(2);
    expect(source).toContain('pointer-events-none');
  });
});
