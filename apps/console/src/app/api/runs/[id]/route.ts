import { NextRequest, NextResponse } from 'next/server';
import { getRunById } from '@/lib/runStore';

/**
 * GET /api/runs/[id] — fetch a single run by id (= payment tx hash, lowercased).
 *
 * Useful for clients to poll status if execution were ever async, and for the
 * UI to deep-link to a specific run.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const run = getRunById(params.id);
  if (!run) {
    return NextResponse.json({ error: 'run_not_found', id: params.id }, { status: 404 });
  }
  return NextResponse.json({
    id: run.id,
    jobId: run.jobId,
    agentId: run.agentId,
    payer: run.payer,
    amount: run.amount,
    paymentTxHash: run.paymentTxHash,
    status: run.status,
    input: run.input,
    output: run.output,
    error: run.errorMessage,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  });
}
