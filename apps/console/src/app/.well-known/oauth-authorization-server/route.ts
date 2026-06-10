import { NextResponse } from 'next/server';
import { ALLOWED_MCP_SCOPES, OAUTH_ISSUER } from '@/lib/oauth/scopes';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json({ issuer: OAUTH_ISSUER, authorization_endpoint: `${OAUTH_ISSUER}/oauth/authorize`, token_endpoint: `${OAUTH_ISSUER}/oauth/token`, registration_endpoint: `${OAUTH_ISSUER}/oauth/register`, revocation_endpoint: `${OAUTH_ISSUER}/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code','refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ALLOWED_MCP_SCOPES }, { headers: { 'Cache-Control': 'no-store' } }); }
