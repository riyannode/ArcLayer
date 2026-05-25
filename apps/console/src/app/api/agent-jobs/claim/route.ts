/**
 * POST /api/agent-jobs/claim — atomically claim an agent job
 */

import { NextRequest, NextResponse } from 'next/server';
import { claimAgentJob, withAgentJobNamespace } from '@/lib/agent-jobs/store';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.JOBS_CLAIM);
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => ({}));
    const { jobType, workerId, providerAgentId, claimTtlSeconds } = body;

    if (!workerId || typeof workerId !== 'string') {
      return NextResponse.json({ ok: false, error: 'workerId is required' }, { status: 400 });
    }
    if (!providerAgentId || typeof providerAgentId !== 'string') {
      return NextResponse.json({ ok: false, error: 'providerAgentId is required' }, { status: 400 });
    }

    if (workerId !== auth.key.agentId || providerAgentId !== auth.key.agentId) {
      return NextResponse.json({ ok: false, error: 'agent_id_mismatch' }, { status: 403 });
    }

    const job = await claimAgentJob({
      jobType: jobType ?? undefined,
      workerId,
      providerAgentId,
      claimTtlSeconds: claimTtlSeconds ?? undefined,
    });

    if (!job) {
      return NextResponse.json({ ok: false, error: 'no_jobs_available' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, job: withAgentJobNamespace(job) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[agent-jobs] POST /claim failed:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
