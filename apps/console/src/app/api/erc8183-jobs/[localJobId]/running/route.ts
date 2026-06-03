import { NextRequest, NextResponse } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import {
  getErc8183JobByLocalId,
  markErc8183JobRunning,
} from '@/lib/erc8183-jobs/store';
import { assertErc8183Participant, isErc8183Admin } from '@/lib/erc8183-jobs/authz';
import { escrowRail } from '@/lib/rails/responses';

/**
 * POST /api/erc8183-jobs/[localJobId]/running
 *
 * Off-chain provider metadata transition for ERC-8183 escrow jobs.
 * Requires erc8183:running scope.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ localJobId: string }> },
) {
    const { localJobId } = await params;
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.ERC8183_RUNNING);
    if (auth.error) return auth.error;
    const job = await getErc8183JobByLocalId(localJobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'job_not_found', message: 'ERC-8183 job not found.' },
        { status: 404 },
      );
    }

    if (job.status !== 'claimed') {
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'erc8183_job_not_claimed',
          message: `Job is in status '${job.status}', expected 'claimed'. Claim the job first via POST /api/erc8183-jobs/[localJobId]/claim.`,
        },
        { status: 400 },
      );
    }

    const body = await req.json();
    // Accept providerAgentId as canonical, workerId as deprecated alias
    const providerAgentId: string | undefined = body.providerAgentId;
    const workerId: string | undefined = body.workerId;
    const resolvedProviderId = providerAgentId || workerId;

    if (!resolvedProviderId || typeof resolvedProviderId !== 'string') {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'providerAgentId is required' },
        { status: 400 },
      );
    }

    // Guard: only the assigned provider can mark the job as running
    // Admin keys (erc8183:admin) bypass this check
    const runningAuthError = assertErc8183Participant(job, auth, ['provider']);
    if (runningAuthError) return runningAuthError;

    // Guard: resolvedProviderId must match the claimed worker
    if (resolvedProviderId !== job.workerId) {
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'provider_id_mismatch',
          message: `Provider '${resolvedProviderId}' does not match the claimed provider '${job.workerId}'.`,
        },
        { status: 403 },
      );
    }

    await markErc8183JobRunning({
      localJobId: localJobId,
      workerId: resolvedProviderId,
    });

    return NextResponse.json({
      ok: true,
      ...escrowRail(),
      localJobId: localJobId,
      erc8183JobId: job.erc8183JobId,
      status: 'running',
      providerAgentId: resolvedProviderId,
      message:
        'Off-chain provider metadata set to running. Proceed to POST /api/erc8183-jobs/[localJobId]/submit.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[erc8183-jobs] POST /running failed:', message);
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'running_failed', message },
      { status: 500 },
    );
  }
}
