import { NextResponse } from 'next/server';
import { ALLOWED_MCP_SCOPES, MCP_OAUTH_RESOURCE, OAUTH_ISSUER } from '@/lib/oauth/scopes';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json({ resource: MCP_OAUTH_RESOURCE, authorization_servers: [OAUTH_ISSUER], bearer_methods_supported: ['header'], scopes_supported: ALLOWED_MCP_SCOPES, resource_documentation: `${OAUTH_ISSUER}/docs` }, { headers: { 'Cache-Control': 'no-store' } }); }
