import { NextRequest, NextResponse } from 'next/server';
import { authenticateWalletRequest } from '@/lib/mcp/session-auth';
import { createAuthorizationCode } from '@/lib/oauth/codes';
import { getOAuthClient } from '@/lib/oauth/clients';
import { MCP_OAUTH_RESOURCE, parseScopes } from '@/lib/oauth/scopes';
import { allowOAuthRequest } from '@/lib/oauth/rate-limit';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
function redirectWith(uri: string, params: Record<string,string>) { const target = new URL(uri); Object.entries(params).forEach(([k,v]) => v && target.searchParams.set(k,v)); return NextResponse.redirect(target); }
export async function POST(req: NextRequest) {
  if (!allowOAuthRequest(`authorize:${req.headers.get('x-forwarded-for') ?? 'local'}`, 30)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const auth = await authenticateWalletRequest(req); if (!auth.authenticated) return NextResponse.json({ error: 'wallet_session_required' }, { status: 401 });
  const contentType = req.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await req.json().catch(() => ({})) as Record<string, unknown> : Object.fromEntries((await req.formData()).entries()); const clientId = String(body.client_id ?? ''); const redirectUri = String(body.redirect_uri ?? ''); const state = String(body.state ?? '');
  const client = await getOAuthClient(clientId); if (!client || !(client.redirect_uris as string[]).includes(redirectUri)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  if (body.decision === 'deny') return redirectWith(redirectUri, { error: 'access_denied', state });
  const scopes = parseScopes(String(body.scope ?? '')); if (!scopes || body.response_type !== 'code' || body.code_challenge_method !== 'S256' || !body.code_challenge || body.resource !== MCP_OAUTH_RESOURCE) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  try { const issued = await createAuthorizationCode({ clientId, clientName: client.client_name, ownerWallet: auth.wallet, redirectUri, resource: MCP_OAUTH_RESOURCE, scopes, codeChallenge: String(body.code_challenge) }); return redirectWith(redirectUri, { code: issued.raw, state }); } catch { return NextResponse.json({ error: 'server_error' }, { status: 500 }); }
}
