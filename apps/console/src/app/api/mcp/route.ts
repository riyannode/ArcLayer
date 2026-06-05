/**
 * ArcLayer Global MCP — Thin route handler.
 *
 * Parses HTTP request, creates RequestContext, delegates to server helpers.
 * All tool logic lives in apps/console/src/lib/mcp/server.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/mcp/registry';
import { handleMcpPost, handleMcpGet } from '@/lib/mcp/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function buildContext(req: NextRequest, method: string): RequestContext {
  const url = new URL(req.url);
  return {
    origin: url.origin,
    method,
    userAgent: req.headers.get('user-agent'),
    ip: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null,
    authorization: req.headers.get('authorization'),
  };
}

export async function GET(req: NextRequest) {
  const ctx = buildContext(req, 'GET');
  const { searchParams } = new URL(req.url);
  const result = await handleMcpGet(searchParams, ctx);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const ctx = buildContext(req, 'POST');
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: invalid JSON' } }, { status: 400 });
  }

  const { json, status } = await handleMcpPost(body, ctx);
  return NextResponse.json(json, { status });
}
