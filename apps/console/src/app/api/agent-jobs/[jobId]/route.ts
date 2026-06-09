import { humanJson } from '@/lib/api/human-json';
/**
 * GET /api/agent-jobs/[jobId] — get job with events
 */

import { NextRequest } from 'next/server';
import { getAgentJob, withAgentJobNamespace } from '@/lib/agent-jobs/store';
import { wrongRailEscrowError, offchainJobRail } from '@/lib/rails/responses';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await params;
    const result = await getAgentJob(jobId);

    if (!result) {
      return humanJson(_req, { ok: false, error: 'not_found' }, { status: 404 });
    }

    if (result.settlement_mode === 'erc8183_escrow') {
      return humanJson(_req, wrongRailEscrowError(), { status: 409 });
    }

    return humanJson(_req, { ok: true, ...offchainJobRail(), ...withAgentJobNamespace(result) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[agent-jobs] GET /[jobId] failed:', msg);
    return humanJson(_req, { ok: false, error: msg }, { status: 500 });
  }
}
