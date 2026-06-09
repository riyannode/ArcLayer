import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import {
  getErc8183JobByLocalId,
  claimErc8183Job,
} from '@/lib/erc8183-jobs/store';
import { assertErc8183Participant, isErc8183Admin } from '@/lib/erc8183-jobs/authz';
import { escrowRail } from '@/lib/rails/responses';

/**
 * POST /api/erc8183-jobs/[localJobId]/claim
 *
 * Off-chain provider metadata claim for ERC-8183 escrow jobs.
 * Requires erc8183:claim scope.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ localJobId: string }> },
) {
    const { localJobId } = await params;
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.ERC8183_CLAIM);
    if (auth.error) return auth.error;
    const job = await getErc8183JobByLocalId(localJobId);
    if (!job) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'job_not_found', message: 'ERC-8183 job not found.' }, { status: 404 });
    }

    // Guard: only the provider can claim this job
    const claimAuthError = assertErc8183Participant(job, auth, ['provider']);
    if (claimAuthError) return claimAuthError;

    // Guard: must be funded on-chain before off-chain claim
    if (job.erc8183Status !== 'Funded') {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'erc8183_job_not_funded',
          message:
            'Job must be funded on-chain (erc8183_status=Funded) before off-chain provider claim.',
        }, { status: 400 });
    }

    if (job.status !== 'created') {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'erc8183_job_already_claimed',
          message: `Job is in status '${job.status}', expected 'created'.`,
        }, { status: 409 });
    }

    const body = await req.json();
    const { providerAgentId, claimTtlSeconds } = body;
    // Accept deprecated workerId as alias
    const workerId: string | undefined = body.workerId;

    if (!providerAgentId || typeof providerAgentId !== 'string') {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'providerAgentId is required' }, { status: 400 });
    }

    // Guard: providerAgentId in body must match authenticated key
    if (isErc8183Admin(auth.key.scopes) === false && providerAgentId !== auth.key.agentId) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'participant_mismatch',
          expectedRole: 'provider',
          expectedAgentId: providerAgentId,
          authenticatedAgentId: auth.key.agentId,
          hint: 'providerAgentId in claim body must match the authenticated key agentId.',
        }, { status: 403 });
    }

    await claimErc8183Job({
      localJobId: localJobId,
      workerId: workerId || providerAgentId,
      providerAgentId,
      claimTtlSeconds: claimTtlSeconds ?? undefined,
    });

    return humanJson(req, {
      ok: true,
      ...escrowRail(),
      localJobId: localJobId,
      erc8183JobId: job.erc8183JobId,
      status: 'claimed',
      workerId,
      providerAgentId,
      message:
        'Off-chain provider metadata claimed. Proceed to POST /api/erc8183-jobs/[localJobId]/running.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[erc8183-jobs] POST /claim failed:', message);
    return humanJson(req, { ok: false, ...escrowRail(), error: 'claim_failed', message }, { status: 500 });
  }
}
