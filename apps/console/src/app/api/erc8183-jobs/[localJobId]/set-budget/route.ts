import { NextRequest, NextResponse } from 'next/server';
import { CONTRACTS } from '@arclayer/sdk';
import { getErc8183JobByLocalId } from '@/lib/erc8183-jobs/store';
import type { TxInstruction } from '@/lib/erc8183-jobs/types';

export async function POST(
  req: NextRequest,
  { params }: { params: { localJobId: string } },
) {
  try {
    const job = await getErc8183JobByLocalId(params.localJobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, error: 'job_not_found', message: 'ERC-8183 job not found.' },
        { status: 404 },
      );
    }

    // Guard: erc8183_job_id must exist (createJob tx confirmed)
    if (!job.erc8183JobId) {
      return NextResponse.json(
        { ok: false, error: 'create_job_pending', message: 'createJob tx must be confirmed first. POST /api/erc8183-jobs/[localJobId]/created.' },
        { status: 400 },
      );
    }

    const tx: TxInstruction = {
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      functionName: 'setBudget',
      args: [job.erc8183JobId, job.priceAtomic, '0x'],
    };

    return NextResponse.json({
      ok: true,
      settlementMode: 'erc8183_escrow',
      nextAction: 'setBudget',
      localJobId: params.localJobId,
      erc8183JobId: job.erc8183JobId,
      tx,
      message: 'Sign and broadcast setBudget tx, then POST /api/erc8183-jobs/[localJobId]/tx with tx_hash=set_budget.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'set_budget_failed', message },
      { status: 500 },
    );
  }
}
