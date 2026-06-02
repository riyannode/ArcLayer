/**
 * GET /api/erc8183-jobs/[localJobId] — get ERC-8183 escrow job detail
 *
 * Returns full job detail with normalized lifecycle status,
 * timeline, proof/result hashes, tx hashes.
 *
 * Auth: dual auth (API key OR wallet session):
 *   1. API key — preserves existing behavior for bot/API callers
 *   2. Wallet session — for frontend job detail page (participant-only)
 *
 * Wallet session access:
 *   - No session → 401
 *   - Session but not participant → 403
 *   - Participant → full detail + currentUserRole
 */
import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { buildErc8183JobDetail } from '@/lib/erc8183-jobs/read-model';
import { getErc8183JobByLocalId } from '@/lib/erc8183-jobs/store';
import { escrowRail } from '@/lib/rails/responses';
import {
  resolveSessionFromCookie,
  getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, max-age=0' } as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ localJobId: string }> },
) {
  try {
    const { localJobId } = await params;

    // ── 1. Try API key auth first ──────────────────────────────────────
    const apiKeyAuth = await requireApiKey(req, [
      API_KEY_SCOPES.ERC8183_CREATE,
      API_KEY_SCOPES.ERC8183_TX,
    ]);

    if (!apiKeyAuth.error) {
      // API key auth succeeded — preserve existing behavior
      const detail = await buildErc8183JobDetail(localJobId);
      if (!detail) {
        return NextResponse.json(
          { ok: false, ...escrowRail(), error: 'not_found' },
          { status: 404, headers: NO_STORE },
        );
      }
      return NextResponse.json(
        { ok: true, ...escrowRail(), job: detail },
        { headers: NO_STORE },
      );
    }

    // ── 2. API key auth failed — try wallet session ────────────────────
    const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

    if (!cookie) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'unauthorized', message: 'No session or API key provided' },
        { status: 401, headers: NO_STORE },
      );
    }

    const session = await resolveSessionFromCookie(cookie);
    if (!session) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'unauthorized', message: 'Invalid or expired session' },
        { status: 401, headers: NO_STORE },
      );
    }

    // Load job
    const job = await getErc8183JobByLocalId(localJobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'not_found' },
        { status: 404, headers: NO_STORE },
      );
    }

    // Check participant access
    const linkedAgents = await getLinkedErc8004AgentsForController(session.wallet);
    const linkedAgentIds = linkedAgents.map((a) => a.agentId.toLowerCase());

    const isBuyer = linkedAgentIds.includes(job.buyerAgentId?.toLowerCase() ?? '');
    const isProvider = job.providerAgentId
      ? linkedAgentIds.includes(job.providerAgentId.toLowerCase())
      : false;
    const isEvaluator = job.evaluatorAgentId
      ? linkedAgentIds.includes(job.evaluatorAgentId.toLowerCase())
      : false;

    if (!isBuyer && !isProvider && !isEvaluator) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'forbidden', message: 'Session wallet does not control a participant agent' },
        { status: 403, headers: NO_STORE },
      );
    }

    // Build full detail
    const detail = await buildErc8183JobDetail(localJobId);
    if (!detail) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'not_found' },
        { status: 404, headers: NO_STORE },
      );
    }

    // Determine current user role
    let currentUserRole: 'client' | 'worker' | 'evaluator' = 'client';
    if (isEvaluator) currentUserRole = 'evaluator';
    if (isProvider) currentUserRole = 'worker';
    if (isBuyer) currentUserRole = 'client'; // buyer takes priority

    return NextResponse.json(
      { ok: true, ...escrowRail(), job: detail, currentUserRole },
      { headers: NO_STORE },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'get_failed', message },
      { status: 500, headers: NO_STORE },
    );
  }
}
