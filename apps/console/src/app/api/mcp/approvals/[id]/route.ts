/**
 * MCP Approval — GET /api/mcp/approvals/[id]
 *
 * Returns approval only if it belongs to the authenticated session.
 * Does NOT expose token_hash or session internals.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authAndFetchApproval, approvalResponse } from '../_helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await authAndFetchApproval(req, id);
  if (!result.ok) return result.response;
  return approvalResponse(result.ctx.approval);
}
