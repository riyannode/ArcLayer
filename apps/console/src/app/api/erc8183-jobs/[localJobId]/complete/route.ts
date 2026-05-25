import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { CONTRACTS } from '@arclayer/sdk';
import { getErc8183JobByLocalId } from '@/lib/erc8183-jobs/store';
import type { TxInstruction } from '@/lib/erc8183-jobs/types';

export async function POST(
  req: NextRequest,
  { params }: { params: { localJobId: string } },
) {
  try {
    const body = await req.json();
    const approved = body.approved !== false; // default true

    // MVP: rejections not supported yet
    if (!approved) {
      return NextResponse.json(
        {
          ok: false,
          error: 'unsupported_rejection_flow',
          message: 'Rejection flow is not supported in MVP. Set approved=true or use a manual dispute process.',
        },
        { status: 400 },
      );
    }

    const job = await getErc8183JobByLocalId(params.localJobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, error: 'job_not_found', message: 'ERC-8183 job not found.' },
        { status: 404 },
      );
    }

    if (!job.erc8183JobId) {
      return NextResponse.json(
        { ok: false, error: 'create_job_pending', message: 'createJob tx must be confirmed first.' },
        { status: 400 },
      );
    }

    const reason = body.reason ?? 'deliverable-approved';
    const reasonHash: `0x${string}` = `0x${createHash('sha256').update(Buffer.from(reason, 'utf8')).digest('hex')}`;

    const tx: TxInstruction = {
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      functionName: 'complete',
      args: [job.erc8183JobId, reasonHash, '0x'],
    };

    return NextResponse.json({
      ok: true,
      settlementMode: 'erc8183_escrow',
      nextAction: 'complete',
      localJobId: params.localJobId,
      erc8183JobId: job.erc8183JobId,
      reasonHash,
      tx,
      message: 'Sign and broadcast complete tx, then POST /api/erc8183-jobs/[localJobId]/tx with tx_hash=complete.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'complete_failed', message },
      { status: 500 },
    );
  }
}
