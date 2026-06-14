/**
 * ArcLayer Global MCP — Route handler.
 *
 * POST-only. Uses official @modelcontextprotocol/sdk WebStandardStreamableHTTPServerTransport.
 * GET/DELETE/PUT/PATCH → 405 with Allow: POST.
 */

import { NextRequest, NextResponse } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { RequestContext } from '@/lib/mcp/registry';
import { resolveMcpBearerAuth, MCP_OAUTH_CHALLENGE } from '@/lib/mcp/auth';
import { createArcLayerMcpServer } from '@/lib/mcp/sdk-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ─── ALLOWED ORIGINS ─────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
  'https://arclayers.xyz',
  'https://www.arclayers.xyz',
  // Add configured preview/test origins from env
  ...(process.env.MCP_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? []),
]);

function validateOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  // No origin = server-to-server MCP client, allow
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

// ─── BUILD CONTEXT ───────────────────────────────────────────────────────────

async function buildAuthenticatedContext(
  req: NextRequest,
): Promise<RequestContext & { auth: NonNullable<Awaited<ReturnType<typeof resolveMcpBearerAuth>>> }> {
  const url = new URL(req.url);
  const auth = await resolveMcpBearerAuth(req.headers.get('authorization'));

  if (!auth) {
    throw new Response(null, {
      status: 401,
      headers: { 'WWW-Authenticate': MCP_OAUTH_CHALLENGE },
    });
  }

  return {
    origin: url.origin,
    method: 'POST',
    userAgent: req.headers.get('user-agent'),
    ip: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null,
    authorization: req.headers.get('authorization'),
    auth,
  };
}

// ─── HANDLERS ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  // Origin validation
  if (!validateOrigin(req)) {
    return new NextResponse('Forbidden: invalid origin', { status: 403 });
  }

  // Authenticate and build context
  let context: Awaited<ReturnType<typeof buildAuthenticatedContext>>;
  try {
    context = await buildAuthenticatedContext(req);
  } catch (response) {
    return response as Response;
  }

  // Create request-scoped MCP server and transport
  const server = createArcLayerMcpServer(context);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    // Pass the untouched Request to the transport
    const response = await transport.handleRequest(req);
    return response;
  } finally {
    // Cleanup after response is produced
    await server.close().catch(() => {});
  }
}

export async function GET(): Promise<Response> {
  return new NextResponse('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
  });
}

export async function DELETE(): Promise<Response> {
  return new NextResponse('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
  });
}

export async function PUT(): Promise<Response> {
  return new NextResponse('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
  });
}

export async function PATCH(): Promise<Response> {
  return new NextResponse('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
  });
}
