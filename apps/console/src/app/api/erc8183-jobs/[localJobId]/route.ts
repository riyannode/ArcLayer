import { humanJson } from '@/lib/api/human-json';
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
import { NextRequest } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { buildErc8183JobDetail } from '@/lib/erc8183-jobs/read-model';
import { getErc8183JobByLocalId, getErc8183JobByOnchainId } from '@/lib/erc8183-jobs/store';
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

    // ── Resolve numeric on-chain ID to local job ID ─────────────────
    // The URL param may be a numeric erc8183JobId (from /job/<onchainId>)
    // or a local erc8183_* job ID. Resolve to localJobId for read-model.
    let resolvedLocalJobId = localJobId;
    if (/^\d+$/.test(localJobId)) {
      const onchainJob = await getErc8183JobByOnchainId(localJobId);
      if (onchainJob) {
        resolvedLocalJobId = onchainJob.localJobId;
      }
    }

    // ── 1. Try API key auth first ──────────────────────────────────────
    const apiKeyAuth = await requireApiKey(req, [
      API_KEY_SCOPES.ERC8183_CREATE,
      API_KEY_SCOPES.ERC8183_TX,
    ]);

    if (!apiKeyAuth.error) {
      // API key auth succeeded — preserve existing behavior
      const detail = await buildErc8183JobDetail(resolvedLocalJobId);
      if (!detail) {
        return humanJson(req, { ok: false, ...escrowRail(), error: 'not_found' }, { status: 404, headers: NO_STORE });
      }
      return humanJson(req, { ok: true, ...escrowRail(), job: detail }, { headers: NO_STORE });
    }

    // ── 2. API key auth failed — try wallet session ────────────────────
    const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

    if (!cookie) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'unauthorized', message: 'No session or API key provided' }, { status: 401, headers: NO_STORE });
    }

    const session = await resolveSessionFromCookie(cookie);
    if (!session) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'unauthorized', message: 'Invalid or expired session' }, { status: 401, headers: NO_STORE });
    }

    // Load job
    const job = await getErc8183JobByLocalId(resolvedLocalJobId);
    if (!job) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'not_found' }, { status: 404, headers: NO_STORE });
    }

    // Check participant access — compare both agentId and tokenId
    const linkedAgents = await getLinkedErc8004AgentsForController(session.wallet);
    const linkedAgentIds = new Set(
      linkedAgents
        .flatMap((a) => [a.agentId?.toLowerCase(), a.tokenId?.toLowerCase()])
        .filter(Boolean),
    );

    const isBuyer = linkedAgentIds.has(job.buyerAgentId?.toLowerCase() ?? '');
    const isProvider = job.providerAgentId
      ? linkedAgentIds.has(job.providerAgentId.toLowerCase())
      : false;
    const isEvaluator = job.evaluatorAgentId
      ? linkedAgentIds.has(job.evaluatorAgentId.toLowerCase())
      : false;
    const isWorker = job.workerId
      ? linkedAgentIds.has(job.workerId.toLowerCase())
      : false;

    if (!isBuyer && !isProvider && !isEvaluator && !isWorker) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'forbidden', message: 'Session wallet does not control a participant agent' }, { status: 403, headers: NO_STORE });
    }

    // Build full detail
    const detail = await buildErc8183JobDetail(resolvedLocalJobId);
    if (!detail) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'not_found' }, { status: 404, headers: NO_STORE });
    }

    // Determine current user role — priority: buyer > evaluator > provider
    let currentUserRole: 'client' | 'provider' | 'evaluator' = 'provider';
    if (isEvaluator) currentUserRole = 'evaluator';
    if (isBuyer) currentUserRole = 'client';

    return humanJson(req, { ok: true, ...escrowRail(), job: detail, currentUserRole }, { headers: NO_STORE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return humanJson(req, { ok: false, error: 'get_failed', message }, { status: 500, headers: NO_STORE });
  }
}
