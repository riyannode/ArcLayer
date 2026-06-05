/**
 * MCP Approval — POST /api/mcp/approvals/[id]/approve
 *
 * Transition: awaiting_approval → approved.
 * Requires MCP Bearer token.
 * Rejects expired/cancelled/submitted/confirmed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authAndFetchApproval, approvalResponse, transitionErrorResponse } from '../../_helpers';
import { approveApproval } from '@/lib/mcp/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await authAndFetchApproval(req, id);
  if (!result.ok) return result.response;

  const transition = await approveApproval(id, result.ctx.auth.session);
  if (!transition.ok) return transitionErrorResponse(transition);

  return approvalResponse(transition.approval);
}
