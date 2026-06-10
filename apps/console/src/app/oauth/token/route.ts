import { NextRequest, NextResponse } from 'next/server';
import { findAuthorizationCode, consumeAuthorizationCode } from '@/lib/oauth/codes';
import { getOAuthClient } from '@/lib/oauth/clients';
import { verifyPkceS256 } from '@/lib/oauth/pkce';
import { allowOAuthRequest } from '@/lib/oauth/rate-limit';
import { readOAuthBody } from '@/lib/oauth/request';
import { MCP_OAUTH_RESOURCE } from '@/lib/oauth/scopes';
import { getActiveConnection } from '@/lib/oauth/store';
import { findRefreshToken, issueTokenPair, rotateRefreshToken } from '@/lib/oauth/token-store';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
function error(error: string, description: string, status = 400) { return NextResponse.json({ error, error_description: description }, { status, headers }); }
export async function POST(req: NextRequest) {
  if (!allowOAuthRequest(`token:${req.headers.get('x-forwarded-for') ?? 'local'}`, 40)) return error('temporarily_unavailable','Rate limit exceeded',429);
  const body = await readOAuthBody(req); const grant = String(body.grant_type ?? '');
  if (grant === 'authorization_code') {
    const raw = String(body.code ?? ''); const row = await findAuthorizationCode(raw); const clientId = String(body.client_id ?? '');
    if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now() || row.client_id !== clientId || row.redirect_uri !== body.redirect_uri || row.resource !== (body.resource ?? MCP_OAUTH_RESOURCE) || !verifyPkceS256(String(body.code_verifier ?? ''), row.code_challenge)) return error('invalid_grant','Authorization code validation failed');
    const client = await getOAuthClient(clientId); if (!client) return error('invalid_client','Client is unavailable');
    const { data: connection } = await (await import('@/lib/oauth/store')).oauthDb().from('mcp_oauth_connections').select('*').eq('client_id', clientId).eq('owner_wallet', row.owner_wallet).eq('status','active').is('revoked_at',null).maybeSingle();
    if (!connection || !(await consumeAuthorizationCode(row.id))) return error('invalid_grant','Authorization code is unavailable');
    const pair = await issueTokenPair({ clientId, ownerWallet: row.owner_wallet, connectionId: connection.id, scopes: row.scopes });
    return NextResponse.json({ access_token: pair.accessToken, refresh_token: pair.refreshToken, token_type: 'Bearer', expires_in: pair.expiresIn, scope: row.scopes.join(' ') }, { headers });
  }
  if (grant === 'refresh_token') {
    const row = await findRefreshToken(String(body.refresh_token ?? '')); if (!row || row.revoked_at || row.rotated_at || new Date(row.expires_at).getTime() <= Date.now() || (body.client_id && row.client_id !== body.client_id)) return error('invalid_grant','Refresh token validation failed');
    const connection = await getActiveConnection(row.connection_id); if (!connection || !(await rotateRefreshToken(row.id))) return error('invalid_grant','Refresh token is unavailable');
    const pair = await issueTokenPair({ clientId: row.client_id, ownerWallet: row.owner_wallet, connectionId: row.connection_id, scopes: row.scopes });
    return NextResponse.json({ access_token: pair.accessToken, refresh_token: pair.refreshToken, token_type: 'Bearer', expires_in: pair.expiresIn, scope: row.scopes.join(' ') }, { headers });
  }
  return error('unsupported_grant_type','Use authorization_code or refresh_token');
}
