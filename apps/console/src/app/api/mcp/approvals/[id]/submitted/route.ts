/**
 * MCP Approval — POST /api/mcp/approvals/[id]/submitted
 *
 * Transition: approved → submitted.
 * Body: { txHash } (required, 0x + 64 hex chars).
 * No tx execution here — caller signs and broadcasts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authAndFetchApproval, approvalResponse, transitionErrorResponse } from '../../_helpers';
import { submitApproval } from '@/lib/mcp/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await authAndFetchApproval(req, id);
  if (!result.ok) return result.response;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 },
    );
  }

  const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : '';
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_tx_hash', detail: 'Must be 0x + 64 hex chars.' },
      { status: 400 },
    );
  }

  const transition = await submitApproval(id, result.ctx.auth.session, txHash);
  if (!transition.ok) return transitionErrorResponse(transition);

  return approvalResponse(transition.approval);
}
