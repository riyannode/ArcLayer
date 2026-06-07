/**
 * GET /api/mcp/signing-requests/[id] — Read request status/result.
 *
 * Used by MCP server to poll request outcome.
 * No wallet session auth — requestId is sufficient for PR 1.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRequest } from '@/lib/mcp/signing-bridge/store';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const request = await getRequest(id);
    if (!request) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      request: {
        id: request.id,
        sessionId: request.session_id,
        actionType: request.action_type,
        chainId: request.chain_id,
        expectedClientWallet: request.expected_client_wallet,
        transactions: request.transactions,
        summary: request.summary,
        result: request.result,
        status: request.status,
        txHash: request.tx_hash,
        expiresAt: request.expires_at,
        createdAt: request.created_at,
        updatedAt: request.updated_at,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'read_failed' },
      { status: 500 },
    );
  }
}
