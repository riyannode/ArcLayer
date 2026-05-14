import { NextRequest, NextResponse } from 'next/server';
import { listRunsByJob } from '@/lib/runStore';

/**
 * GET /api/jobs/[id]/runs — list off-chain agent execution runs for a jobId.
 *
 * Each on-chain job can have multiple runs (e.g. retries with new payment).
 * Returns latest first.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const runs = listRunsByJob(params.id);
  return NextResponse.json({
    jobId: params.id,
    count: runs.length,
    runs: runs.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      agentId: r.agentId,
      payer: r.payer,
      amount: r.amount,
      paymentTxHash: r.paymentTxHash,
      status: r.status,
      input: r.input,
      output: r.output,
      error: r.errorMessage,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    })),
  });
}
