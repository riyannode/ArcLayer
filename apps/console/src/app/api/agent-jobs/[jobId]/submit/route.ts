/**
 * POST /api/agent-jobs/[jobId]/submit — submit job result
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentJob, submitAgentJob, withAgentJobNamespace } from '@/lib/agent-jobs/store';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.JOBS_SUBMIT);
    if (auth.error) return auth.error;

    const { jobId } = await params;
    const body = await req.json().catch(() => ({}));
    const { workerId, resultPayload, proofPayload } = body;

    if (!workerId || typeof workerId !== 'string') {
      return NextResponse.json({ ok: false, error: 'workerId is required' }, { status: 400 });
    }
    if (workerId !== auth.key.agentId) {
      return NextResponse.json({ ok: false, error: 'agent_id_mismatch' }, { status: 403 });
    }
    if (!resultPayload || typeof resultPayload !== 'object') {
      return NextResponse.json({ ok: false, error: 'resultPayload is required and must be an object' }, { status: 400 });
    }

    // Block ERC-8183 escrow jobs — they use /api/erc8183-jobs/* routes
    const existing = await getAgentJob(jobId);
    if (existing && existing.settlement_mode === 'erc8183_escrow') {
      return NextResponse.json(
        {
          ok: false,
          error: 'erc8183_jobs_use_erc8183_routes',
          message:
            'This job uses ERC-8183 escrow. Use /api/erc8183-jobs/* routes and AgenticCommerce.complete(), not legacy x402 job routes.',
        },
        { status: 409 },
      );
    }

    const job = await submitAgentJob({ jobId, workerId, resultPayload, proofPayload: proofPayload ?? undefined });
    return NextResponse.json({ ok: true, job: withAgentJobNamespace(job) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[agent-jobs] POST /submit failed:', msg);
    const status = msg.includes('not found') ? 404 : msg.includes('mismatch') ? 403 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
