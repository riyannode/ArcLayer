import 'server-only';
import { MCP_OAUTH_RESOURCE } from './scopes';
import { generateOAuthSecret, hashOAuthSecret } from './tokens';
import { oauthDb } from './store';
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export async function issueTokenPair(input: { clientId: string; ownerWallet: string; connectionId: string; scopes: string[] }) {
  const accessToken = generateOAuthSecret('arc_at_'); const refreshToken = generateOAuthSecret('arc_rt_'); const now = Date.now();
  const { error: accessError } = await oauthDb().from('oauth_access_tokens').insert({ token_hash: hashOAuthSecret(accessToken), client_id: input.clientId, owner_wallet: input.ownerWallet, connection_id: input.connectionId, resource: MCP_OAUTH_RESOURCE, scopes: input.scopes, expires_at: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString() });
  if (accessError) throw new Error('oauth_access_token_create_failed');
  const { error: refreshError } = await oauthDb().from('oauth_refresh_tokens').insert({ token_hash: hashOAuthSecret(refreshToken), client_id: input.clientId, owner_wallet: input.ownerWallet, connection_id: input.connectionId, scopes: input.scopes, expires_at: new Date(now + 30 * 24 * 60 * 60_000).toISOString() });
  if (refreshError) throw new Error('oauth_refresh_token_create_failed'); return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}
export async function findRefreshToken(raw: string) { const { data } = await oauthDb().from('oauth_refresh_tokens').select('*').eq('token_hash', hashOAuthSecret(raw)).maybeSingle(); return data; }
export async function rotateRefreshToken(id: string): Promise<boolean> { const now = new Date().toISOString(); const { data } = await oauthDb().from('oauth_refresh_tokens').update({ rotated_at: now, revoked_at: now }).eq('id', id).is('revoked_at', null).is('rotated_at', null).select('id').maybeSingle(); return !!data; }
export async function revokeRawToken(raw: string): Promise<void> { const hash = hashOAuthSecret(raw); const now = new Date().toISOString(); await Promise.all([oauthDb().from('oauth_access_tokens').update({ revoked_at: now }).eq('token_hash', hash).is('revoked_at', null), oauthDb().from('oauth_refresh_tokens').update({ revoked_at: now }).eq('token_hash', hash).is('revoked_at', null)]); }
