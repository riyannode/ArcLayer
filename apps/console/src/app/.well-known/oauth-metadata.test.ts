import { describe, expect, it } from 'vitest';
import { GET as authorizationServer } from './oauth-authorization-server/route';
import { GET as protectedResource } from './oauth-protected-resource/route';
describe('OAuth metadata', () => {
  it('publishes ArcLayer protected resource metadata without caching', async () => {
    const response = await protectedResource(); const body = await response.json();
    expect(body.resource).toBe('https://arclayers.xyz/api/mcp');
    expect(body.authorization_servers).toEqual(['https://arclayers.xyz']);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('publishes authorization, token, registration, revocation, and PKCE metadata', async () => {
    const response = await authorizationServer(); const body = await response.json();
    expect(body.authorization_endpoint).toBe('https://arclayers.xyz/oauth/authorize');
    expect(body.token_endpoint).toBe('https://arclayers.xyz/oauth/token');
    expect(body.registration_endpoint).toBe('https://arclayers.xyz/oauth/register');
    expect(body.revocation_endpoint).toBe('https://arclayers.xyz/oauth/revoke');
    expect(body.code_challenge_methods_supported).toEqual(['S256']);
  });
});
