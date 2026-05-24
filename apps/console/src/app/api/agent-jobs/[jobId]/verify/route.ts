/**
 * POST /api/agent-jobs/[jobId]/verify — verify submitted job result
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAgentJob } from '@/lib/agent-jobs/store';

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
    const { verifierAgentId, approved, reason, metadata } = body;

    if (!verifierAgentId || typeof verifierAgentId !== 'string') {
      return NextResponse.json({ ok: false, error: 'verifierAgentId is required' }, { status: 400 });
    }
    if (typeof approved !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'approved must be a boolean' }, { status: 400 });
    }

    const job = await verifyAgentJob({
      jobId,
      verifierAgentId,
      approved,
      reason: reason ?? undefined,
      metadata: metadata ?? undefined,
    });

    return NextResponse.json({ ok: true, job });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[agent-jobs] POST /verify failed:', msg);
    const status = msg.includes('not found') ? 404 : 400;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
