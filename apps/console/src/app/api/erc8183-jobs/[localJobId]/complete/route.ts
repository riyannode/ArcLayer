import { NextRequest, NextResponse } from 'next/server';
import { keccak256, toBytes } from 'viem';
import { CONTRACTS } from '@arclayer/sdk';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { getErc8183JobByLocalId, attachErc8183PreparedComplete } from '@/lib/erc8183-jobs/store';
import { assertErc8183Participant } from '@/lib/erc8183-jobs/authz';
import { escrowRail } from '@/lib/rails/responses';
import type { TxInstruction } from '@/lib/erc8183-jobs/types';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ localJobId: string }> },
) {
    const { localJobId } = await params;
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.ERC8183_COMPLETE);
    if (auth.error) return auth.error;
    const body = await req.json();
    const approved = body.approved !== false; // default true

    // MVP: rejections not supported yet
    if (!approved) {
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'unsupported_rejection_flow',
          message: 'Rejection flow is not supported in MVP. Set approved=true or use a manual dispute process.',
        },
        { status: 400 },
      );
    }

    const job = await getErc8183JobByLocalId(localJobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'job_not_found', message: 'ERC-8183 job not found.' },
        { status: 404 },
      );
    }

    // Guard: only the evaluator or buyer (client) can complete the job
    const completeAuthError = assertErc8183Participant(job, auth, ['evaluator', 'buyer']);
    if (completeAuthError) return completeAuthError;

    if (!job.erc8183JobId) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'create_job_pending', message: 'createJob tx must be confirmed first.' },
        { status: 400 },
      );
    }

    const reason = body.reason ?? 'deliverable-approved';
    const reasonHash: `0x${string}` = keccak256(toBytes(reason));

    // Persist reasonHash to local mirror before returning tx instruction
    await attachErc8183PreparedComplete({
      localJobId: localJobId,
      reasonHash,
    });

    const tx: TxInstruction = {
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      functionName: 'complete',
      args: [job.erc8183JobId, reasonHash, '0x'],
    };

    return NextResponse.json({
      ok: true,
      ...escrowRail(),
      nextAction: 'complete',
      localJobId: localJobId,
      erc8183JobId: job.erc8183JobId,
      reasonHash,
      tx,
      message: 'Sign and broadcast complete tx, then POST /api/erc8183-jobs/[localJobId]/tx with tx_hash=complete.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'complete_failed', message },
      { status: 500 },
    );
  }
}
