/**
 * GET /api/mcp/manifest — Service discovery for ArcLayer MCP.
 *
 * Returns public metadata about the MCP endpoint.
 * No authentication required.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(): Promise<Response> {
  const body = JSON.stringify(
    {
      service: 'ArcLayer MCP',
      endpoint: '/api/mcp',
      transport: 'Streamable HTTP',
      method: 'POST',
      protocolVersion: '2025-03-26',
      auth: 'Bearer token required',
      docs: 'https://arclayers.xyz/global-mcp',
      manifest: '/api/mcp/manifest',
    },
    null,
    2,
  );

  return new NextResponse(body + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Allow: 'GET',
    },
  });
}
