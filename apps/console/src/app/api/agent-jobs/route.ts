import { humanJson } from '@/lib/api/human-json';
/**
 * GET  /api/agent-jobs — list agent jobs
 * POST /api/agent-jobs — create agent job
 */

import { NextRequest } from 'next/server';
import { createAgentJob, listAgentJobs, withAgentJobNamespace } from '@/lib/agent-jobs/store';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { offchainJobRail, escrowRail } from '@/lib/rails/responses';
import type { ListAgentJobsFilter } from '@/lib/agent-jobs/store';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filter: ListAgentJobsFilter = {};

    const settlementMode = searchParams.get('settlementMode');
    if (settlementMode === 'x402_offchain' || settlementMode === 'erc8183_escrow') {
      filter.settlementMode = settlementMode;
    }

    const status = searchParams.get('status');
    if (status) filter.status = status as ListAgentJobsFilter['status'];

    const jobType = searchParams.get('jobType');
    if (jobType) filter.jobType = jobType;

    const marketId = searchParams.get('marketId');
    if (marketId) filter.marketId = marketId;

    const buyerAgentId = searchParams.get('buyerAgentId');
    if (buyerAgentId) filter.buyerAgentId = buyerAgentId;

    const workerId = searchParams.get('workerId');
    if (workerId) filter.workerId = workerId;

    const limit = searchParams.get('limit');
    if (limit) filter.limit = parseInt(limit, 10);

    const offset = searchParams.get('offset');
    if (offset) filter.offset = parseInt(offset, 10);

    const jobs = await listAgentJobs(filter);
    const effectiveSettlementMode = filter.settlementMode ?? 'x402_offchain';
    const rail = effectiveSettlementMode === 'erc8183_escrow' ? escrowRail() : offchainJobRail();
    return humanJson(req, { ok: true, ...rail, jobs: jobs.map(withAgentJobNamespace) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[agent-jobs] GET failed:', msg);
    return humanJson(req, { ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.JOBS_CREATE);
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => ({}));
    const { jobType, buyerAgentId, inputPayload, priceAtomic, marketId, deadlineAt, metadata } = body;

    if (!jobType || typeof jobType !== 'string') {
      return humanJson(req, { ok: false, error: 'jobType is required' }, { status: 400 });
    }
    if (!buyerAgentId || typeof buyerAgentId !== 'string') {
      return humanJson(req, { ok: false, error: 'buyerAgentId is required' }, { status: 400 });
    }
    if (!inputPayload || typeof inputPayload !== 'object') {
      return humanJson(req, { ok: false, error: 'inputPayload is required and must be an object' }, { status: 400 });
    }

    if (buyerAgentId !== auth.key.agentId) {
      return humanJson(req, { ok: false, error: 'agent_id_mismatch', field: 'buyerAgentId' }, { status: 403 });
    }

    const job = await createAgentJob({
      jobType,
      buyerAgentId,
      inputPayload,
      priceAtomic: priceAtomic ?? '0',
      marketId: marketId ?? undefined,
      deadlineAt: deadlineAt ?? undefined,
      metadata: metadata ?? undefined,
    });

    return humanJson(req, { ok: true, job: withAgentJobNamespace(job) }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[agent-jobs] POST failed:', msg);
    return humanJson(req, { ok: false, error: msg }, { status: 500 });
  }
}
