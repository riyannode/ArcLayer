/**
 * MCP Approvals — Shared route helpers.
 *
 * Auth + approval lookup pattern used by all approval sub-routes.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authenticateMcpRequest, type McpAuthResponse } from '@/lib/mcp/session-auth';
import { getApproval, type McpActionApproval } from '@/lib/mcp/approvals';

export { type McpActionApproval };

// ── Auth helper ───────────────────────────────────────────────────────────

export interface AuthedContext {
  auth: McpAuthResponse & { authenticated: true };
  approval: McpActionApproval;
}

/**
 * Authenticate MCP request and fetch approval by ID, scoped to session.
 * Returns error response if anything fails.
 */
export async function authAndFetchApproval(
  req: NextRequest,
  approvalId: string,
): Promise<{ ok: true; ctx: AuthedContext } | { ok: false; response: NextResponse }> {
  // 1. Authenticate MCP token
  const auth = await authenticateMcpRequest(req);
  if (!auth.authenticated) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status },
      ),
    };
  }

  // 2. Fetch approval scoped to session
  const approval = await getApproval(approvalId, auth.session.id);
  if (!approval) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'approval_not_found' },
        { status: 404 },
      ),
    };
  }

  return { ok: true, ctx: { auth, approval } };
}

/**
 * Standard error response for transition failures.
 */
export function transitionErrorResponse(result: { ok: false; error: string; detail?: string }): NextResponse {
  const status = result.error.includes('not_found') ? 404
    : result.error.includes('expired') ? 410
    : result.error.includes('invalid_transition') ? 409
    : 400;

  return NextResponse.json(
    { ok: false, error: result.error, ...(result.detail ? { detail: result.detail } : {}) },
    { status },
  );
}

/**
 * Standard success response with approval (no token_hash or sensitive data).
 */
export function approvalResponse(approval: McpActionApproval): NextResponse {
  return NextResponse.json({
    ok: true,
    approval: {
      id: approval.id,
      action: approval.action,
      chainId: approval.chainId,
      toAddress: approval.toAddress,
      data: approval.data,
      value: approval.value,
      summary: approval.summary,
      status: approval.status,
      txHash: approval.txHash,
      error: approval.error,
      createdAt: approval.createdAt,
      expiresAt: approval.expiresAt,
      approvedAt: approval.approvedAt,
      cancelledAt: approval.cancelledAt,
      submittedAt: approval.submittedAt,
      confirmedAt: approval.confirmedAt,
    },
  });
}
