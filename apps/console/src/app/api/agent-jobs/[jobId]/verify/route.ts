/**
 * POST /api/agent-jobs/[jobId]/verify — verify submitted job result
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentJob, verifyAgentJob, withAgentJobNamespace } from '@/lib/agent-jobs/store';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.JOBS_VERIFY);
    if (auth.error) return auth.error;

    const { jobId } = await params;
    const body = await req.json().catch(() => ({}));
    const { verifierAgentId, approved, reason, metadata } = body;

    if (!verifierAgentId || typeof verifierAgentId !== 'string') {
      return NextResponse.json({ ok: false, error: 'verifierAgentId is required' }, { status: 400 });
    }
    if (verifierAgentId !== auth.key.agentId) {
      return NextResponse.json({ ok: false, error: 'agent_id_mismatch' }, { status: 403 });
    }
    if (typeof approved !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'approved must be a boolean' }, { status: 400 });
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

    const job = await verifyAgentJob({
      jobId,
      verifierAgentId,
      approved,
      reason: reason ?? undefined,
      metadata: metadata ?? undefined,
    });

    return NextResponse.json({ ok: true, job: withAgentJobNamespace(job) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[agent-jobs] POST /verify failed:', msg);
    const status = msg.includes('not found') ? 404 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
