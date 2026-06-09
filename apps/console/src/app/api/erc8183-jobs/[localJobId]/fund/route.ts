import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { CONTRACTS, ARC_TOKENS } from '@arclayer/sdk';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { getErc8183JobByLocalId } from '@/lib/erc8183-jobs/store';
import { assertErc8183Participant } from '@/lib/erc8183-jobs/authz';
import { escrowRail } from '@/lib/rails/responses';
import { readOnchainJob } from '@/lib/erc8183-jobs/receipt';
import { ERC8183JobStatus } from '@/lib/contracts/erc8183';
import type { TxInstruction } from '@/lib/erc8183-jobs/types';

/** Local DB statuses that are past the fundable window. */
const UNFUNDABLE_LOCAL_STATUSES = new Set([
  'claimed',
  'running',
  'submitted',
  'completed',
  'settled',
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ localJobId: string }> },
) {
    const { localJobId } = await params;
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.ERC8183_CONFIRM);
    if (auth.error) return auth.error;
    const job = await getErc8183JobByLocalId(localJobId);
    if (!job) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'job_not_found', message: 'ERC-8183 job not found.' }, { status: 404 });
    }

    // Guard: only the buyer (client) can approve+fund the escrow
    const fundAuthError = assertErc8183Participant(job, auth, ['buyer']);
    if (fundAuthError) return fundAuthError;

    if (!job.erc8183JobId) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'create_job_pending', message: 'createJob tx must be confirmed first.' }, { status: 400 });
    }

    // ── Local guards ──────────────────────────────────────────────────────

    // 1. setBudget must be confirmed before fund is allowed
    if (!job.setBudgetTxHash) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'budget_not_set',
          message: 'Provider must set budget before client can fund this job.',
        }, { status: 409 });
    }

    // 2. priceAtomic must be present and positive
    const priceAtomic = Number(job.priceAtomic);
    if (!job.priceAtomic || Number.isNaN(priceAtomic) || priceAtomic <= 0) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'budget_zero',
          message: 'Job budget is zero or missing. Provider must set a valid budget first.',
        }, { status: 409 });
    }

    // 3. Already funded — idempotency guard
    if (job.fundTxHash) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'already_funded',
          message: 'This job has already been funded.',
        }, { status: 409 });
    }

    // 4. Lifecycle status must be fundable
    if (job.status && UNFUNDABLE_LOCAL_STATUSES.has(job.status)) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'job_not_fundable_status',
          message: `Job status '${job.status}' is not fundable.`,
        }, { status: 409 });
    }

    // 5. Job expiry check — null/undefined/0 = not expired
    if (job.expiredAtUnix && Number(job.expiredAtUnix) > 0) {
      const expiredAtMs = Number(job.expiredAtUnix) * 1000;
      if (Date.now() > expiredAtMs) {
        return humanJson(req, {
            ok: false,
            ...escrowRail(),
            error: 'job_expired',
            message: 'This job has expired and can no longer be funded.',
          }, { status: 409 });
      }
    }

    // ── On-chain guard ────────────────────────────────────────────────────

    const onchainJob = await readOnchainJob(BigInt(job.erc8183JobId));

    if (!onchainJob) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'rpc_unavailable',
          message: 'Unable to verify on-chain job state. Please try again.',
        }, { status: 503 });
    }

    // 6. On-chain budget must be set (> 0)
    if (onchainJob.budget === 0n) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'budget_not_set',
          message: 'On-chain budget is zero. Provider must call setBudget before funding.',
        }, { status: 409 });
    }

    // 7. On-chain status must be Open (0) for funding
    if (onchainJob.status !== ERC8183JobStatus.Open) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'job_not_fundable_status',
          message: `On-chain job status is '${onchainJob.erc8183Status}', not Open. Cannot fund.`,
        }, { status: 409 });
    }

    // ── Budget mismatch warning (non-blocking) ────────────────────────────

    if (onchainJob.budget !== BigInt(priceAtomic)) {
      console.warn(
        `[fund] budget_mismatch localJobId=${localJobId} erc8183JobId=${job.erc8183JobId} ` +
        `local_priceAtomic=${job.priceAtomic} onchain_budget=${onchainJob.budget.toString()}`,
      );
    }

    // ── All checks passed — return tx instructions ────────────────────────

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

    return humanJson(req, {
      ok: true,
      ...escrowRail(),
      nextAction: 'approveAndFund',
      localJobId: localJobId,
      erc8183JobId: job.erc8183JobId,
      txs: [approveTx, fundTx],
      message: 'Sign and broadcast approve tx first, then fund tx. After both confirmed, POST /api/erc8183-jobs/[localJobId]/tx with tx_hash=fund.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return humanJson(req, { ok: false, ...escrowRail(), error: 'fund_failed', message }, { status: 500 });
  }
}
