import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import {
  getErc8183JobByLocalId,
  claimErc8183Job,
} from '@/lib/erc8183-jobs/store';

/**
 * POST /api/erc8183-jobs/[localJobId]/claim
 *
 * Off-chain worker metadata claim for ERC-8183 escrow jobs.
 * Requires erc8183:claim scope.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { localJobId: string } },
) {
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.ERC8183_CLAIM);
    if (auth.error) return auth.error;
    const job = await getErc8183JobByLocalId(params.localJobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, error: 'job_not_found', message: 'ERC-8183 job not found.' },
        { status: 404 },
      );
    }

    // Guard: must be funded on-chain before off-chain claim
    if (job.erc8183Status !== 'Funded') {
      return NextResponse.json(
        {
          ok: false,
          error: 'erc8183_job_not_funded',
          message:
            'Job must be funded on-chain (erc8183_status=Funded) before off-chain worker claim.',
        },
        { status: 400 },
      );
    }

    if (job.status !== 'created') {
      return NextResponse.json(
        {
          ok: false,
          error: 'erc8183_job_already_claimed',
          message: `Job is in status '${job.status}', expected 'created'.`,
        },
        { status: 409 },
      );
    }

    const body = await req.json();
    const { workerId, providerAgentId, claimTtlSeconds } = body;

    if (!workerId || typeof workerId !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'workerId is required' },
        { status: 400 },
      );
    }
    if (!providerAgentId || typeof providerAgentId !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'providerAgentId is required' },
        { status: 400 },
      );
    }

    await claimErc8183Job({
      localJobId: params.localJobId,
      workerId,
      providerAgentId,
      claimTtlSeconds: claimTtlSeconds ?? undefined,
    });

    return NextResponse.json({
      ok: true,
      settlementMode: 'erc8183_escrow',
      localJobId: params.localJobId,
      erc8183JobId: job.erc8183JobId,
      status: 'claimed',
      workerId,
      providerAgentId,
      message:
        'Off-chain worker metadata claimed. Proceed to POST /api/erc8183-jobs/[localJobId]/running.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[erc8183-jobs] POST /claim failed:', message);
    return NextResponse.json(
      { ok: false, error: 'claim_failed', message },
      { status: 500 },
    );
  }
}
