import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

let resolveMcpBearerAuth: typeof import('./auth').resolveMcpBearerAuth;

beforeAll(async () => {
  ({ resolveMcpBearerAuth } = await import('./auth'));
});

describe('MCP OAuth enforcement', () => {
  it('returns null for missing token', async () => {
    const result = await resolveMcpBearerAuth(null);
    expect(result).toBeNull();
  });

  it('returns null for empty token', async () => {
    const result = await resolveMcpBearerAuth('');
    expect(result).toBeNull();
  });

  it('returns null for invalid token format', async () => {
    const result = await resolveMcpBearerAuth('Bearer invalid_token');
    expect(result).toBeNull();
  });

  it('returns null for legacy session without scopes', async () => {
    // Legacy sessions without explicit scopes should be rejected
    const result = await resolveMcpBearerAuth('Bearer arc_mcp_sess_nonexistent');
    expect(result).toBeNull();
  });
});
