/**
 * MCP Approval — POST /api/mcp/approvals/[id]/cancel
 *
 * Transition: awaiting_approval or approved → cancelled.
 * Idempotent if already cancelled by same session.
 */

import { NextRequest } from 'next/server';
import { authAndFetchApproval, approvalResponse, transitionErrorResponse } from '../../_helpers';
import { cancelApproval } from '@/lib/mcp/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await authAndFetchApproval(req, id);
  if (!result.ok) return result.response;

  const transition = await cancelApproval(id, result.ctx.auth.session);
  if (!transition.ok) return transitionErrorResponse(transition);

  return approvalResponse(transition.approval);
}
