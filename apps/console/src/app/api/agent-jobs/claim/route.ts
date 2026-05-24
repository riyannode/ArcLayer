/**
 * POST /api/agent-jobs/claim — atomically claim an agent job
 */

import { NextRequest, NextResponse } from 'next/server';
import { claimAgentJob } from '@/lib/agent-jobs/store';

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization');
    const apiKey = process.env.ARCLAYER_API_KEY;
    if (!auth || !apiKey || auth.replace('Bearer ', '').trim() !== apiKey.trim()) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { jobType, workerId, providerAgentId, claimTtlSeconds } = body;

    if (!workerId || typeof workerId !== 'string') {
      return NextResponse.json({ ok: false, error: 'workerId is required' }, { status: 400 });
    }
    if (!providerAgentId || typeof providerAgentId !== 'string') {
      return NextResponse.json({ ok: false, error: 'providerAgentId is required' }, { status: 400 });
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

    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[agent-jobs] POST /claim failed:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
