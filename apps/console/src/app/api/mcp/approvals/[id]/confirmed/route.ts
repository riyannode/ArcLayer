/**
 * MCP Approval — POST /api/mcp/approvals/[id]/confirmed
 *
 * Transition: submitted → confirmed or failed.
 * Body: { receiptStatus (required), txHash?, blockNumber? }
 * receiptStatus: 'success' → confirmed, 'reverted' → failed.
 * No indexer assumptions — caller provides status from receipt.
 *
 * STRICT:
 * - receiptStatus is required, must be exactly "success" or "reverted".
 * - If txHash provided, must match already-submitted txHash.
 * - Never overwrites submitted txHash with different txHash.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authAndFetchApproval, approvalResponse, transitionErrorResponse } from '../../_helpers';
import { confirmApproval } from '@/lib/mcp/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await authAndFetchApproval(req, id);
  if (!result.ok) return result.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json', detail: 'Request body required with receiptStatus.' },
      { status: 400 },
    );
  }

  // receiptStatus is REQUIRED
  const receiptStatus = typeof body.receiptStatus === 'string' ? body.receiptStatus.trim() : '';
  if (receiptStatus !== 'success' && receiptStatus !== 'reverted') {
    return NextResponse.json(
      { ok: false, error: 'invalid_receipt_status', detail: 'receiptStatus must be exactly "success" or "reverted".' },
      { status: 400 },
    );
  }

  const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : undefined;
  const blockNumber = typeof body.blockNumber === 'number' ? body.blockNumber : undefined;

  const transition = await confirmApproval(id, result.ctx.auth.session, {
    txHash,
    blockNumber,
    receiptStatus,
  });
  if (!transition.ok) return transitionErrorResponse(transition);

  return approvalResponse(transition.approval);
}
