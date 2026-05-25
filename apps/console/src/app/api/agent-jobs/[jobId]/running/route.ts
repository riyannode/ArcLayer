/**
 * POST /api/agent-jobs/[jobId]/running — mark job as running
 */

import { NextRequest, NextResponse } from 'next/server';
import { markJobRunning, withAgentJobNamespace } from '@/lib/agent-jobs/store';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> | { jobId: string } },
) {
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.JOBS_SUBMIT);
    if (auth.error) return auth.error;

    const { jobId } = await params;
    const body = await req.json().catch(() => ({}));
    const { workerId } = body;

    if (!workerId || typeof workerId !== 'string') {
      return NextResponse.json({ ok: false, error: 'workerId is required' }, { status: 400 });
    }
    if (workerId !== auth.key.agentId) {
      return NextResponse.json({ ok: false, error: 'agent_id_mismatch' }, { status: 403 });
    }

    const job = await markJobRunning({ jobId, workerId });
    return NextResponse.json({ ok: true, job: withAgentJobNamespace(job) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[agent-jobs] POST /running failed:', msg);
    const status = msg.includes('not found') ? 404 : msg.includes('mismatch') ? 403 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
