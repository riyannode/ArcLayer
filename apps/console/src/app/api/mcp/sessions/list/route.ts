/**
 * MCP Session — List.
 *
 * GET /api/mcp/sessions/list
 * Auth: wallet session cookie.
 *
 * Returns ALL MCP sessions for the authenticated owner (active, expired, revoked).
 * Token hashes are NOT returned (security).
 * Each session includes a computed status field.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateWalletRequest } from '@/lib/mcp/session-auth';
import { listSessionsForOwner } from '@/lib/mcp/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // 1. Authenticate wallet session
  const auth = await authenticateWalletRequest(req);
  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  // 2. List sessions (all statuses)
  const sessions = await listSessionsForOwner(auth.wallet);

  // 3. Return sessions (without token hashes, with computed status)
  return NextResponse.json({
    ok: true,
    sessions: sessions.map((s) => ({
      id: s.id,
      agentAccountAddress: s.agentAccountAddress,
      permissions: s.permissions,
      autoApprove: s.autoApprove,
      status: s.status,
      expiresAt: s.expiresAt,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      revokedAt: s.revokedAt,
    })),
    total: sessions.length,
  });
}
