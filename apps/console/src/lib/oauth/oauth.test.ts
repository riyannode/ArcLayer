import { describe, expect, it } from 'vitest';
import { isAllowedRedirectUri } from './validation';
import { pkceChallenge, verifyPkceS256 } from './pkce';
import { ALLOWED_MCP_SCOPES, MCP_OAUTH_RESOURCE, parseScopes } from './scopes';

describe('MCP OAuth validation', () => {
  it('accepts HTTPS and loopback redirects and rejects unsafe redirects', () => {
    expect(isAllowedRedirectUri('https://client.example/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:1455/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:1455/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://example.com/callback')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
    expect(isAllowedRedirectUri('https://*.example.com/callback')).toBe(false);
  });
  it('requires PKCE S256 verifier equality', () => {
    const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
    const challenge = pkceChallenge(verifier);
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256(`${verifier}x`, challenge)).toBe(false);
  });
  it('accepts only declared ArcLayer scopes and resource', () => {
    expect(MCP_OAUTH_RESOURCE).toBe('https://arclayers.xyz/api/mcp');
    expect(parseScopes(ALLOWED_MCP_SCOPES.join(' '))).toEqual(ALLOWED_MCP_SCOPES);
    expect(parseScopes('arclayer:read admin')).toBeNull();
  });
});
