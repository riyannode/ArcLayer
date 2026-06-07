/**
 * GET /api/mcp/signing-requests/pending?sessionId=...
 *
 * Poll pending requests for a session. Called by Profile page every 2s.
 * No wallet session auth — sessionId is sufficient for PR 1.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPendingRequests, expireStaleRequests } from '@/lib/mcp/signing-bridge/store';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 });
  }

  try {
    // Expire stale requests before fetching (cheap, idempotent)
    await expireStaleRequests();

    const requests = await getPendingRequests(sessionId);

    return NextResponse.json({
      ok: true,
      requests: requests.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        actionType: r.action_type,
        chainId: r.chain_id,
        expectedClientWallet: r.expected_client_wallet,
        transactions: r.transactions,
        summary: r.summary,
        status: r.status,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'fetch_failed' },
      { status: 500 },
    );
  }
}
