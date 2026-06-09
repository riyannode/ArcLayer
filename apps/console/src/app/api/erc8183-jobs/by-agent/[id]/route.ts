import { humanJson } from '@/lib/api/human-json';
/**
 * GET /api/erc8183-jobs/by-agent/[id] — ERC-8183 jobs by agent profile
 *
 * Returns ERC-8183 jobs where this agent participates.
 *
 * Visibility model:
 * - No session / non-owner: returns public-safe provider job summaries only (asProviderPublic)
 * - Owner session: returns grouped private lists (asClient, asProvider, asEvaluator)
 *
 * Do not expose private data (controllers, full descriptions, payloads) to non-owners.
 */

import { NextRequest } from 'next/server';
import {
  resolveSessionFromCookie,
  getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';
import { listErc8183Jobs } from '@/lib/erc8183-jobs/store';
import {
  normalizeErc8183LifecycleStatus,
  getNextActionLabel,
} from '@/lib/erc8183-jobs/read-model';
import { escrowRail } from '@/lib/rails/responses';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, max-age=0' } as const;

// ── Public-safe provider summary ─────────────────────────────────────────────

interface PublicProviderSummary {
  localJobId: string;
  erc8183JobId: string | null;
  lifecycleStatus: string;
  status: string;
  budget: string | null;
  createdAt: string;
  expiredAtUnix: string | null;
  shortDescription: string | null;
  createTxHash: string | null;
  inputPayloadHash: string;
}

function toPublicProviderSummary(
  job: Awaited<ReturnType<typeof listErc8183Jobs>>[number],
): PublicProviderSummary {
  const desc = job.description ?? null;
  const shortDescription =
    desc && desc.length > 100 ? desc.slice(0, 97) + '...' : desc;

  return {
    localJobId: job.localJobId,
    erc8183JobId: job.erc8183JobId,
    lifecycleStatus: normalizeErc8183LifecycleStatus(job),
    status: job.status,
    budget: job.priceAtomic ?? null,
    createdAt: job.createdAt,
    expiredAtUnix: job.expiredAtUnix,
    shortDescription,
    createTxHash: job.createTxHash,
    inputPayloadHash: job.inputPayloadHash,
  };
}

// ── Private job summary (for owner) ────────────────────────────────────────

interface PrivateJobSummary {
  localJobId: string;
  erc8183JobId: string | null;
  lifecycleStatus: string;
  status: string;
  buyerAgentId: string;
  providerAgentId: string | null;
  evaluatorAgentId: string | null;
  buyerController: string | null;
  providerController: string | null;
  evaluatorController: string | null;
  budget: string | null;
  shortDescription: string | null;
  createdAt: string;
  expiredAtUnix: string | null;
  createTxHash: string | null;
  inputPayloadHash: string;
  nextAction: string | null;
}

function toPrivateJobSummary(
  job: Awaited<ReturnType<typeof listErc8183Jobs>>[number],
): PrivateJobSummary {
  const desc = job.description ?? null;
  const shortDescription =
    desc && desc.length > 100 ? desc.slice(0, 97) + '...' : desc;
  const lifecycleStatus = normalizeErc8183LifecycleStatus(job);

  return {
    localJobId: job.localJobId,
    erc8183JobId: job.erc8183JobId,
    lifecycleStatus,
    status: job.status,
    buyerAgentId: job.buyerAgentId,
    providerAgentId: job.providerAgentId,
    evaluatorAgentId: job.evaluatorAgentId,
    buyerController: job.clientAddress,
    providerController: job.providerAddress,
    evaluatorController: job.evaluatorAddress,
    budget: job.priceAtomic ?? null,
    shortDescription,
    createdAt: job.createdAt,
    expiredAtUnix: job.expiredAtUnix,
    createTxHash: job.createTxHash,
    inputPayloadHash: job.inputPayloadHash,
    nextAction: getNextActionLabel(lifecycleStatus),
  };
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: agentId } = await params;

    // Try wallet session auth
    const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    let isOwner = false;

    if (cookie) {
      const session = await resolveSessionFromCookie(cookie);
      if (session) {
        const linkedAgents = await getLinkedErc8004AgentsForController(
          session.wallet,
        );
        isOwner = linkedAgents.some(
          (a) =>
            a.agentId === agentId ||
            a.tokenId === agentId ||
            a.agentId.toLowerCase() === agentId.toLowerCase() ||
            a.tokenId.toLowerCase() === agentId.toLowerCase(),
        );
      }
    }

    if (isOwner) {
      // Owner: return grouped private lists
      const [asClient, asProvider, asEvaluator] = await Promise.all([
        listErc8183Jobs({ buyerAgentId: agentId, limit: 100 }),
        listErc8183Jobs({ providerAgentId: agentId, limit: 100 }),
        listErc8183Jobs({ evaluatorAgentId: agentId, limit: 100 }),
      ]);

      return humanJson(req, {
          ok: true,
          ...escrowRail(),
          agentId,
          isOwner: true,
          asProviderPublic: [],
          asClient: asClient.map(toPrivateJobSummary),
          asProvider: asProvider.map(toPrivateJobSummary),
          asEvaluator: asEvaluator.map(toPrivateJobSummary),
        }, { headers: NO_STORE });
    }

    // Public: return only safe provider summaries
    const asProvider = await listErc8183Jobs({
      providerAgentId: agentId,
      limit: 100,
    });

    return humanJson(req, {
        ok: true,
        ...escrowRail(),
        agentId,
        isOwner: false,
        asProviderPublic: asProvider.map(toPublicProviderSummary),
        asClient: [],
        asProvider: [],
        asEvaluator: [],
      }, { headers: NO_STORE });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return humanJson(req, { ok: false, error: 'by_agent_failed', message }, { status: 500, headers: NO_STORE });
  }
}
