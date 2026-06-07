/**
 * POST /api/mcp/signing-requests — Create a signing request.
 *
 * Auth: sessionId validation only (PR 1). No API key.
 * MCP server calls this with the sessionId from .env.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createRequest } from '@/lib/mcp/signing-bridge/store';
import { WhitelistError } from '@/lib/mcp/signing-bridge/whitelist';
import type { SigningTransaction, SigningRequestSummary } from '@/lib/mcp/signing-bridge/whitelist';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const sessionId = String(body.sessionId || '').trim();
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 });
    }

    const actionType = String(body.actionType || '').trim();
    if (!actionType) {
      return NextResponse.json({ ok: false, error: 'actionType required' }, { status: 400 });
    }

    const chainId = Number(body.chainId);
    if (!Number.isFinite(chainId)) {
      return NextResponse.json({ ok: false, error: 'chainId required' }, { status: 400 });
    }

    const expectedClientWallet = String(body.expectedClientWallet || '').trim();
    if (!expectedClientWallet) {
      return NextResponse.json({ ok: false, error: 'expectedClientWallet required' }, { status: 400 });
    }

    const transactions = body.transactions as SigningTransaction[] | undefined;
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return NextResponse.json({ ok: false, error: 'transactions array required' }, { status: 400 });
    }

    const summary = body.summary as SigningRequestSummary | undefined;

    const request = await createRequest(
      sessionId,
      actionType,
      chainId,
      expectedClientWallet,
      transactions,
      summary,
    );

    return NextResponse.json({
      ok: true,
      request: {
        id: request.id,
        sessionId: request.session_id,
        actionType: request.action_type,
        status: request.status,
        expiresAt: request.expires_at,
        createdAt: request.created_at,
      },
    });
  } catch (err) {
    if (err instanceof WhitelistError) {
      return NextResponse.json(
        { ok: false, error: err.code, detail: err.message },
        { status: 400 },
      );
    }

    const message = err instanceof Error ? err.message : 'create_failed';
    // Session not active → 403
    if (message.includes('not active')) {
      return NextResponse.json({ ok: false, error: 'session_not_active', detail: message }, { status: 403 });
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
