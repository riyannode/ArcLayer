import { NextRequest, NextResponse } from 'next/server';
import { CONTRACTS, ARC_TOKENS } from '@arclayer/sdk';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { getErc8183JobByLocalId } from '@/lib/erc8183-jobs/store';
import { assertErc8183Participant } from '@/lib/erc8183-jobs/authz';
import { escrowRail } from '@/lib/rails/responses';
import type { TxInstruction } from '@/lib/erc8183-jobs/types';

export async function POST(
  req: NextRequest,
  { params }: { params: { localJobId: string } },
) {
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.ERC8183_CONFIRM);
    if (auth.error) return auth.error;
    const job = await getErc8183JobByLocalId(params.localJobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'job_not_found', message: 'ERC-8183 job not found.' },
        { status: 404 },
      );
    }

    // Guard: only the buyer (client) can approve+fund the escrow
    const fundAuthError = assertErc8183Participant(job, auth, ['buyer']);
    if (fundAuthError) return fundAuthError;

    if (!job.erc8183JobId) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'create_job_pending', message: 'createJob tx must be confirmed first.' },
        { status: 400 },
      );
    }

    const approveTx: TxInstruction = {
      address: ARC_TOKENS.USDC,
      functionName: 'approve',
      args: [CONTRACTS.ERC8183_AGENTIC_COMMERCE, job.priceAtomic],
    };

    const fundTx: TxInstruction = {
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      functionName: 'fund',
      args: [job.erc8183JobId, '0x'],
    };

    return NextResponse.json({
      ok: true,
      ...escrowRail(),
      nextAction: 'approveAndFund',
      localJobId: params.localJobId,
      erc8183JobId: job.erc8183JobId,
      txs: [approveTx, fundTx],
      message: 'Sign and broadcast approve tx first, then fund tx. After both confirmed, POST /api/erc8183-jobs/[localJobId]/tx with tx_hash=fund.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'fund_failed', message },
      { status: 500 },
    );
  }
}
