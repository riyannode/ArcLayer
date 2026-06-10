import { NextRequest, NextResponse } from 'next/server';
import { registerOAuthClient } from '@/lib/oauth/clients';
import { isAllowedRedirectUri } from '@/lib/oauth/validation';
import { allowOAuthRequest } from '@/lib/oauth/rate-limit';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  if (!allowOAuthRequest(`register:${req.headers.get('x-forwarded-for') ?? 'local'}`, 20)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  let body: Record<string, unknown>; try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 }); }
  const clientName = typeof body.client_name === 'string' ? body.client_name.trim() : '';
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((v): v is string => typeof v === 'string') : [];
  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code','refresh_token'];
  const responseTypes = Array.isArray(body.response_types) ? body.response_types : ['code'];
  const authMethod = body.token_endpoint_auth_method ?? 'none';
  if (!clientName || !redirectUris.length || !redirectUris.every(isAllowedRedirectUri) || !grantTypes.every((v) => typeof v === 'string' && ['authorization_code','refresh_token'].includes(v)) || !grantTypes.includes('authorization_code') || !responseTypes.every((v) => v === 'code') || !responseTypes.includes('code') || authMethod !== 'none') return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 });
  try { const client = await registerOAuthClient({ clientName, redirectUris, grantTypes: grantTypes as string[], responseTypes: responseTypes as string[], tokenEndpointAuthMethod: 'none' }); return NextResponse.json({ client_id: client.client_id, client_name: client.client_name, redirect_uris: client.redirect_uris, grant_types: client.grant_types, response_types: client.response_types, token_endpoint_auth_method: 'none' }, { status: 201, headers: { 'Cache-Control': 'no-store' } }); } catch { return NextResponse.json({ error: 'server_error' }, { status: 500 }); }
}
