import 'server-only';
import { generateOAuthSecret, hashOAuthSecret } from './tokens';
import { findActiveConnection, oauthDb } from './store';
export async function createAuthorizationCode(input: { clientId: string; clientName: string; ownerWallet: string; redirectUri: string; resource: string; scopes: string[]; codeChallenge: string }) {
  let connection = await findActiveConnection(input.clientId, input.ownerWallet);
  if (!connection) { const result = await oauthDb().from('mcp_oauth_connections').insert({ owner_wallet: input.ownerWallet.toLowerCase(), client_id: input.clientId, client_name: input.clientName, client_type: 'codex', scopes: input.scopes, policy_json: {}, status: 'active' }).select('*').single(); if (result.error || !result.data) throw new Error('oauth_connection_create_failed'); connection = result.data; }
  const raw = generateOAuthSecret('arc_code_');
  const { error } = await oauthDb().from('oauth_authorization_codes').insert({ code_hash: hashOAuthSecret(raw), client_id: input.clientId, owner_wallet: input.ownerWallet.toLowerCase(), redirect_uri: input.redirectUri, resource: input.resource, scopes: input.scopes, code_challenge: input.codeChallenge, code_challenge_method: 'S256', expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
  if (error) throw new Error('oauth_code_create_failed'); return { raw, connection };
}
export async function findAuthorizationCode(raw: string) { const { data } = await oauthDb().from('oauth_authorization_codes').select('*').eq('code_hash', hashOAuthSecret(raw)).maybeSingle(); return data; }
export async function consumeAuthorizationCode(id: string): Promise<boolean> { const { data } = await oauthDb().from('oauth_authorization_codes').update({ consumed_at: new Date().toISOString() }).eq('id', id).is('consumed_at', null).select('id').maybeSingle(); return !!data; }
