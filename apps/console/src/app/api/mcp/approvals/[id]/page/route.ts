/**
 * MCP Approval — Wallet-auth page API.
 *
 * GET  /api/mcp/approvals/[id]/page  → fetch approval (wallet cookie auth)
 * POST /api/mcp/approvals/[id]/page  → transition approval (wallet cookie auth)
 *
 * Body for POST: { action: 'approve' | 'cancel' | 'submit' | 'confirm', txHash? }
 *
 * Security:
 * - Auth via wallet session cookie (not MCP Bearer token).
 * - Approval ownerAddress must match authenticated wallet.
 * - Expired approvals rejected.
 * - confirm action fetches receipt from Arc RPC — client cannot force success.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateWalletRequest } from '@/lib/mcp/session-auth';
import {
  getApprovalById,
  getEffectiveStatus,
  approveApprovalByWallet,
  cancelApprovalByWallet,
  submitApprovalByWallet,
  confirmApprovalByWallet,
  type McpActionApproval,
} from '@/lib/mcp/approvals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Helpers ───────────────────────────────────────────────────────────────

function approvalJson(approval: McpActionApproval) {
  return {
    id: approval.id,
    action: approval.action,
    chainId: approval.chainId,
    toAddress: approval.toAddress,
    data: approval.data,
    value: approval.value,
    summary: approval.summary,
    status: getEffectiveStatus(approval),
    txHash: approval.txHash,
    error: approval.error,
    ownerAddress: approval.ownerAddress,
    agentAccountAddress: approval.agentAccountAddress,
    createdAt: approval.createdAt,
    expiresAt: approval.expiresAt,
    approvedAt: approval.approvedAt,
    cancelledAt: approval.cancelledAt,
    submittedAt: approval.submittedAt,
    confirmedAt: approval.confirmedAt,
  };
}

function transitionErrorResponse(result: { ok: false; error: string; detail?: string }) {
  const status = result.error.includes('not_found') ? 404
    : result.error.includes('expired') ? 410
    : result.error.includes('invalid_transition') ? 409
    : result.error.includes('receipt_not_ready') ? 409
    : 400;

  return NextResponse.json(
    { ok: false, error: result.error, ...(result.detail ? { detail: result.detail } : {}) },
    { status },
  );
}

// ── GET ───────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 1. Auth via wallet cookie
  const auth = await authenticateWalletRequest(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  // 2. Fetch approval (no session scoping)
  const approval = await getApprovalById(id);
  if (!approval) {
    return NextResponse.json(
      { ok: false, error: 'approval_not_found' },
      { status: 404 },
    );
  }

  // 3. Verify wallet owns this approval
  if (approval.ownerAddress.toLowerCase() !== auth.wallet.toLowerCase()) {
    return NextResponse.json(
      { ok: false, error: 'wallet_mismatch' },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true, approval: approvalJson(approval) });
}

// ── POST ──────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 1. Parse action first so disabled Agent Account approvals cannot execute.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid_json' },
      { status: 400 },
    );
  }

  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!['approve', 'cancel', 'submit', 'confirm'].includes(action)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_action', detail: 'action must be approve, cancel, submit, or confirm' },
      { status: 400 },
    );
  }

  if (action !== 'cancel' && process.env.MCP_AGENT_ACCOUNT_IDENTITY_ENABLED !== 'true') {
    return NextResponse.json(
      { ok: false, error: 'agent_account_mcp_disabled', detail: 'Agent Account MCP identity mode is temporarily disabled. Use EOA registration.' },
      { status: 403 },
    );
  }

  // 2. Auth via wallet cookie
  const auth = await authenticateWalletRequest(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  // 3. Fetch approval
  const approval = await getApprovalById(id);
  if (!approval) {
    return NextResponse.json(
      { ok: false, error: 'approval_not_found' },
      { status: 404 },
    );
  }

  // 4. Verify wallet owns this approval
  if (approval.ownerAddress.toLowerCase() !== auth.wallet.toLowerCase()) {
    return NextResponse.json(
      { ok: false, error: 'wallet_mismatch' },
      { status: 403 },
    );
  }

  // 5. Execute transition
  let result;

  switch (action) {
    case 'approve':
      result = await approveApprovalByWallet(approval);
      break;

    case 'cancel':
      result = await cancelApprovalByWallet(approval);
      break;

    case 'submit': {
      const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : '';
      if (!txHash) {
        return NextResponse.json(
          { ok: false, error: 'missing_tx_hash' },
          { status: 400 },
        );
      }
      result = await submitApprovalByWallet(approval, txHash);
      break;
    }

    case 'confirm': {
      const txHash = typeof body.txHash === 'string' ? body.txHash.trim() : undefined;
      result = await confirmApprovalByWallet(approval, { txHash });
      break;
    }
  }

  if (!result!.ok) return transitionErrorResponse(result!);
  return NextResponse.json({ ok: true, approval: approvalJson(result!.approval) });
}
