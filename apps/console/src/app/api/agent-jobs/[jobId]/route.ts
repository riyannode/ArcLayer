/**
 * GET /api/agent-jobs/[jobId] — get job with events
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentJob, withAgentJobNamespace } from '@/lib/agent-jobs/store';

function wrongRailEscrowError() {
  return {
    ok: false,
    rail: 'escrow',
    settlementMode: 'erc8183_escrow',
    error: 'wrong_rail',
    message: 'This is an ERC-8183 escrow job. Use /api/erc8183-jobs/* routes, not legacy x402 job routes.',
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> | { jobId: string } },
) {
  try {
    const { jobId } = await params;
    const result = await getAgentJob(jobId);

    if (!result) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    if (result.settlement_mode === 'erc8183_escrow') {
      return NextResponse.json(wrongRailEscrowError(), { status: 409 });
    }

    return NextResponse.json({ ok: true, ...withAgentJobNamespace(result) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[agent-jobs] GET /[jobId] failed:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
