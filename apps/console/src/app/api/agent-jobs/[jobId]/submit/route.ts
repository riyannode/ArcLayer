/**
 * POST /api/agent-jobs/[jobId]/submit — submit job result
 */

import { NextRequest, NextResponse } from 'next/server';
import { submitAgentJob } from '@/lib/agent-jobs/store';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> | { jobId: string } },
) {
  try {
    const auth = req.headers.get('authorization');
    const apiKey = process.env.ARCLAYER_API_KEY;
    if (!auth || !apiKey || auth.replace('Bearer ', '').trim() !== apiKey.trim()) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const { jobId } = await params;
    const body = await req.json().catch(() => ({}));
    const { workerId, resultPayload, proofPayload } = body;

    if (!workerId || typeof workerId !== 'string') {
      return NextResponse.json({ ok: false, error: 'workerId is required' }, { status: 400 });
    }
    if (!resultPayload || typeof resultPayload !== 'object') {
      return NextResponse.json({ ok: false, error: 'resultPayload is required and must be an object' }, { status: 400 });
    }

    const job = await submitAgentJob({ jobId, workerId, resultPayload, proofPayload: proofPayload ?? undefined });
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[agent-jobs] POST /submit failed:', msg);
    const status = msg.includes('not found') ? 404 : msg.includes('mismatch') ? 403 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
