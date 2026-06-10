import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { generateOAuthSecret, hashOAuthSecret } from './tokens';
describe('OAuth token secrecy', () => {
  it('generates prefixed secrets and hashes rather than persisting raw values', () => {
    const raw = generateOAuthSecret('arc_at_'); const hash = hashOAuthSecret(raw);
    expect(raw).toMatch(/^arc_at_[A-Za-z0-9_-]+$/); expect(hash).toMatch(/^[a-f0-9]{64}$/); expect(hash).not.toContain(raw);
  });
});
