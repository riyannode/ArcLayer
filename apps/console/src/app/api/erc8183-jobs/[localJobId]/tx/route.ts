import { NextRequest, NextResponse } from 'next/server';
import { decodeEventLog, parseAbiItem } from 'viem';
import type { Hex } from 'viem';
import { getErc8183JobByLocalId } from '@/lib/erc8183-jobs/store';
import {
  readTransactionReceipt,
  readOnchainJob,
  getArcPublicClient,
} from '@/lib/erc8183-jobs/receipt';
import {
  attachErc8183SetBudgetTx,
  attachErc8183ApproveTx,
  attachErc8183FundTx,
  attachErc8183SubmitTx,
  attachErc8183CompleteTx,
} from '@/lib/erc8183-jobs/store';
import { assertErc8183Participant, isErc8183Admin } from '@/lib/erc8183-jobs/authz';
import { escrowRail } from '@/lib/rails/responses';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { USDC_ABI, CONTRACTS } from '@/lib/contracts';
import {
  parseBudgetSet,
  parseJobFunded,
  parseJobSubmitted,
  parseJobCompleted,
} from '@/lib/contracts/erc8183';
import { ARC_TOKENS } from '@arclayer/sdk';
import type { Erc8183JobView } from '@/lib/erc8183-jobs/types';
import type { ConfirmedReceipt } from '@/lib/erc8183-jobs/receipt';

type TxType = 'set_budget' | 'approve' | 'fund' | 'submit' | 'complete';

const VALID_TX_TYPES: TxType[] = ['set_budget', 'approve', 'fund', 'submit', 'complete'];

// ── Approval event decoder ────────────────────────────────────────────────

const APPROVAL_EVENT = parseAbiItem(
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
);

/**
 * Check whether a transaction receipt contains a USDC Approval event
 * matching the expected client → AgenticCommerce spender + minimum value.
 */
function hasRelevantApprovalLog(receipt: ConfirmedReceipt, job: Erc8183JobView): boolean {
  const owner = (job.clientAddress ?? '').toLowerCase();
  const spender = CONTRACTS.ERC8183_AGENTIC_COMMERCE.toLowerCase();
  const required = BigInt(job.priceAtomic);

  for (const log of receipt.logs ?? []) {
    if (log.address.toLowerCase() !== ARC_TOKENS.USDC.toLowerCase()) continue;

    try {
      const decoded = decodeEventLog({
        abi: [APPROVAL_EVENT],
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName !== 'Approval') continue;

      const args = decoded.args as {
        owner?: `0x${string}`;
        spender?: `0x${string}`;
        value?: bigint;
      };

      if ((args.owner ?? '').toLowerCase() !== owner) continue;
      if ((args.spender ?? '').toLowerCase() !== spender) continue;
      if ((args.value ?? 0n) < required) continue;

      return true;
    } catch {
      continue;
    }
  }

  return false;
}

// ── Event verification helpers ─────────────────────────────────────────────

function sameHex(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}
function isAgenticCommerceLog(log: { address?: string }): boolean {
  return (
    typeof log.address === 'string' &&
    log.address.toLowerCase() === CONTRACTS.ERC8183_AGENTIC_COMMERCE.toLowerCase()
  );
}

function eventError(error: string, txType: string, message: string) {
  return NextResponse.json(
    {
      ok: false,
      ...escrowRail(),
      error,
      txType,
      message,
    },
    { status: 422 },
  );
}

function findBudgetSetEvent(receipt: ConfirmedReceipt, expectedJobId: bigint) {
  for (const log of receipt.logs ?? []) {
    if (!isAgenticCommerceLog(log)) continue;
    const ev = parseBudgetSet(log);
    if (ev && ev.jobId === expectedJobId) return ev;
  }
  return null;
}

function findJobFundedEvent(receipt: ConfirmedReceipt, expectedJobId: bigint) {
  for (const log of receipt.logs ?? []) {
    if (!isAgenticCommerceLog(log)) continue;
    const ev = parseJobFunded(log);
    if (ev && ev.jobId === expectedJobId) return ev;
  }
  return null;
}

function findJobSubmittedEvent(receipt: ConfirmedReceipt, expectedJobId: bigint) {
  for (const log of receipt.logs ?? []) {
    if (!isAgenticCommerceLog(log)) continue;
    const ev = parseJobSubmitted(log);
    if (ev && ev.jobId === expectedJobId) return ev;
  }
  return null;
}

function findJobCompletedEvent(receipt: ConfirmedReceipt, expectedJobId: bigint) {
  for (const log of receipt.logs ?? []) {
    if (!isAgenticCommerceLog(log)) continue;
    const ev = parseJobCompleted(log);
    if (ev && ev.jobId === expectedJobId) return ev;
  }
  return null;
}

// ── On-chain job provenance helpers ───────────────────────────────────────

/**
 * Validate that an on-chain job's fields match the local job record.
 * This prevents cross-job tx hash confusion.
 */
interface OnchainJobMatch {
  client: string;
  provider: string;
  evaluator: string;
  expiredAt: bigint;
  hook: string;
}
function validateOnchainJobMatch(
  onchain: OnchainJobMatch,
  local: Erc8183JobView,
  txType: string,
): NextResponse | null {
  const zeroAddress = '0x0000000000000000000000000000000000000000';

  const localClient = (local.clientAddress ?? '').toLowerCase();
  if (localClient && onchain.client.toLowerCase() !== localClient) {
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'onchain_client_mismatch', txType, message: `On-chain job client ${onchain.client} does not match local job client ${localClient}.` },
      { status: 422 },
    );
  }

  const localProvider = (local.providerAddress ?? '').toLowerCase();
  if (localProvider && onchain.provider.toLowerCase() !== localProvider) {
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'onchain_provider_mismatch', txType, message: `On-chain job provider ${onchain.provider} does not match local job provider ${localProvider}.` },
      { status: 422 },
    );
  }

  const localEval = (local.evaluatorAddress ?? '').toLowerCase();
  if (localEval && onchain.evaluator.toLowerCase() !== localEval && onchain.evaluator.toLowerCase() !== zeroAddress) {
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'onchain_evaluator_mismatch', txType, message: `On-chain job evaluator ${onchain.evaluator} does not match local job evaluator ${localEval} or zero address.` },
      { status: 422 },
    );
  }

  const localExpiredAt = local.expiredAtUnix ? BigInt(local.expiredAtUnix) : null;
  if (localExpiredAt !== null && onchain.expiredAt !== localExpiredAt) {
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'onchain_expired_at_mismatch', txType, message: `On-chain job expiredAt ${onchain.expiredAt} does not match local job expiredAt ${localExpiredAt}.` },
      { status: 422 },
    );
  }

  const localHook = (local.hookAddress ?? zeroAddress).toLowerCase();
  if (onchain.hook.toLowerCase() !== localHook) {
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'onchain_hook_mismatch', txType, message: `On-chain job hook ${onchain.hook} does not match local job hook ${localHook}.` },
      { status: 422 },
    );
  }

  return null; // all fields match
}

/**
 * POST /api/erc8183-jobs/[localJobId]/tx
 *
 * Confirms an on-chain transaction and syncs erc8183_status from the
 * AgenticCommerce contract.
 *
 * Per plan Correction 6:
 *   1. Read transaction receipt
 *   2. Confirm receipt status = success
 *   3. For fund/submit/complete: read AgenticCommerce.getJob(erc8183JobId)
 *   4. Update erc8183_status from on-chain state (not blind txType mapping)
 *
 * For set_budget and approve: on-chain status doesn't change, just store tx hash.
 *
 * All responses include rail='escrow' and settlementMode='erc8183_escrow'.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { localJobId: string } },
) {
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.ERC8183_TX);
    if (auth.error) return auth.error;
    const job = await getErc8183JobByLocalId(params.localJobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'job_not_found', message: 'ERC-8183 job not found.' },
        { status: 404 },
      );
    }

    // Guard: erc8183_job_id must exist (createJob confirmed first)
    if (!job.erc8183JobId) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'create_job_pending', message: 'createJob tx must be confirmed first. POST /api/erc8183-jobs/[localJobId]/created.' },
        { status: 400 },
      );
    }

    const body = await req.json();
    const txType = (body.txType ?? body.tx_type) as TxType | undefined;
    const txHash = (body.txHash ?? body.tx_hash) as Hex | undefined;

    // Guard: txType-driven participant check
    const txRoleMap: Record<string, string[]> = {
      set_budget: ['provider'],
      approve: ['buyer'],
      fund: ['buyer'],
      submit: ['worker', 'provider'],
      complete: ['evaluator', 'buyer'],
    };
    if (txType && !isErc8183Admin(auth.key.scopes)) {
      const allowed = txRoleMap[txType];
      if (allowed) {
        const txAuthError = assertErc8183Participant(job, auth, allowed as any);
        if (txAuthError) return txAuthError;
      }
    }

    if (!txType || !VALID_TX_TYPES.includes(txType)) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'invalid_tx_type', message: `tx_type must be one of: ${VALID_TX_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    if (!txHash || typeof txHash !== 'string' || !txHash.startsWith('0x')) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'invalid_tx_hash', message: 'Valid tx_hash (0x-prefixed) is required.' },
        { status: 400 },
      );
    }

    // Step 1: read transaction receipt
    const receipt = await readTransactionReceipt(txHash);
    if (!receipt) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'tx_not_found', message: 'Transaction not found. It may still be mining. Retry after a few seconds.' },
        { status: 202 },
      );
    }

    // Step 2: confirm receipt success
    if (receipt.status !== 'success') {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'tx_reverted', message: 'Transaction reverted on-chain.' },
        { status: 422 },
      );
    }

    const erc8183JobIdBigInt = BigInt(job.erc8183JobId);

    // Step 3-4: handle by tx type
    switch (txType) {
      case 'set_budget': {
        // Require BudgetSet event in receipt for this job
        const budgetEvent = findBudgetSetEvent(receipt, erc8183JobIdBigInt);
        if (!budgetEvent) {
          return eventError(
            'missing_expected_event',
            'set_budget',
            'setBudget tx receipt does not contain a matching BudgetSet event for this job.',
          );
        }

        if (budgetEvent.amount !== BigInt(job.priceAtomic)) {
          return NextResponse.json(
            {
              ok: false,
              ...escrowRail(),
              error: 'event_amount_mismatch',
              txType: 'set_budget',
              expectedAmount: job.priceAtomic,
              eventAmount: budgetEvent.amount.toString(),
            },
            { status: 422 },
          );
        }

        // Read on-chain job for provenance check
        const onchainBudgetJob = await readOnchainJob(erc8183JobIdBigInt);
        if (!onchainBudgetJob) {
          return NextResponse.json(
            { ok: false, ...escrowRail(), error: 'onchain_job_not_found', message: 'Job not found on-chain. The setBudget tx may have been sent to a different contract.' },
            { status: 422 },
          );
        }

        // Validate on-chain job fields match local job
        const budgetProvenanceError = validateOnchainJobMatch(onchainBudgetJob, job, 'set_budget');
        if (budgetProvenanceError) return budgetProvenanceError;

        // Verify on-chain budget matches local priceAtomic
        if (BigInt(onchainBudgetJob.budget) !== BigInt(job.priceAtomic)) {
          return NextResponse.json(
            {
              ok: false,
              ...escrowRail(),
              error: 'onchain_budget_mismatch',
              txType: 'set_budget',
              expectedBudget: job.priceAtomic,
              onchainBudget: onchainBudgetJob.budget.toString(),
              message: `On-chain budget ${onchainBudgetJob.budget} does not match local priceAtomic ${job.priceAtomic}.`,
            },
            { status: 422 },
          );
        }

        await attachErc8183SetBudgetTx({
          localJobId: params.localJobId,
          setBudgetTxHash: txHash,
        });

        return NextResponse.json({
          ok: true,
          ...escrowRail(),
          localJobId: params.localJobId,
          erc8183JobId: job.erc8183JobId,
          txType: 'set_budget',
          txHash,
          erc8183Status: job.erc8183Status ?? 'Open',
          blockNumber: Number(receipt.blockNumber),
          message: 'setBudget confirmed. Proceed to approve USDC via the fund route.',
        });
      }

      case 'approve': {
        // 1. Receipt must contain a matching Approval(client → AgenticCommerce) log
        if (!hasRelevantApprovalLog(receipt, job)) {
          return NextResponse.json(
            {
              ok: false,
              ...escrowRail(),
              error: 'tx_not_relevant_to_job',
              txType: 'approve',
              message:
                'Approve tx receipt does not contain a matching USDC Approval(client -> AgenticCommerce) event.',
            },
            { status: 422 },
          );
        }

        // 2. Client address must be on record
        const clientAddress = job.clientAddress;
        if (!clientAddress) {
          return NextResponse.json(
            {
              ok: false,
              ...escrowRail(),
              error: 'missing_client_address',
              txType: 'approve',
            },
            { status: 422 },
          );
        }

        // 3. On-chain allowance must be >= priceAtomic after the approve tx
        let actualAllowance: bigint;
        try {
          const pc = getArcPublicClient();
          actualAllowance = await pc.readContract({
            address: ARC_TOKENS.USDC,
            abi: USDC_ABI,
            functionName: 'allowance',
            args: [clientAddress as Hex, CONTRACTS.ERC8183_AGENTIC_COMMERCE],
          }) as bigint;
        } catch (err) {
          return NextResponse.json(
            {
              ok: false,
              ...escrowRail(),
              error: 'allowance_check_failed',
              txType: 'approve',
              message:
                err instanceof Error ? err.message : 'Failed to verify USDC allowance after approve tx.',
            },
            { status: 503 },
          );
        }

        if (actualAllowance < BigInt(job.priceAtomic)) {
          return NextResponse.json(
            {
              ok: false,
              ...escrowRail(),
              error: 'allowance_insufficient_after_approve',
              txType: 'approve',
              clientAddress,
              requiredAllowance: job.priceAtomic,
              actualAllowance: actualAllowance.toString(),
            },
            { status: 422 },
          );
        }

        await attachErc8183ApproveTx({
          localJobId: params.localJobId,
          approveTxHash: txHash,
        });

        return NextResponse.json({
          ok: true,
          ...escrowRail(),
          localJobId: params.localJobId,
          erc8183JobId: job.erc8183JobId,
          txType: 'approve',
          txHash,
          erc8183Status: job.erc8183Status ?? 'Open',
          blockNumber: Number(receipt.blockNumber),
          allowance: actualAllowance.toString(),
          message: 'USDC approve confirmed. Proceed to sign and broadcast the fund tx.',
        });
      }

      case 'fund': {
        // Require JobFunded event in receipt for this job
        const fundedEvent = findJobFundedEvent(receipt, erc8183JobIdBigInt);
        if (!fundedEvent) {
          return eventError(
            'missing_expected_event',
            'fund',
            'fund tx receipt does not contain a matching JobFunded event for this job.',
          );
        }

        if (fundedEvent.amount !== BigInt(job.priceAtomic)) {
          return NextResponse.json(
            {
              ok: false,
              ...escrowRail(),
              error: 'event_amount_mismatch',
              txType: 'fund',
              expectedAmount: job.priceAtomic,
              eventAmount: fundedEvent.amount.toString(),
            },
            { status: 422 },
          );
        }

        // Step 3: read on-chain job state
        const onchainJob = await readOnchainJob(erc8183JobIdBigInt);
        if (!onchainJob) {
          return NextResponse.json(
            { ok: false, ...escrowRail(), error: 'onchain_job_not_found', message: 'Job not found on-chain after fund tx. The contract may have reverted differently than the receipt suggests.' },
            { status: 422 },
          );
        }

        // Provenance: validate on-chain job matches local job
        const fundProvenanceError = validateOnchainJobMatch(onchainJob, job, 'fund');
        if (fundProvenanceError) return fundProvenanceError;

        // Step 4: update from on-chain state
        await attachErc8183FundTx({
          localJobId: params.localJobId,
          fundTxHash: txHash,
          erc8183Status: onchainJob.erc8183Status,
        });

        return NextResponse.json({
          ok: true,
          ...escrowRail(),
          localJobId: params.localJobId,
          erc8183JobId: job.erc8183JobId,
          txType: 'fund',
          txHash,
          erc8183Status: onchainJob.erc8183Status,
          onchainStatus: onchainJob.status,
          blockNumber: Number(receipt.blockNumber),
          message: 'Fund confirmed. Proceed to claim the job.',
        });
      }

      case 'submit': {
        // Require JobSubmitted event in receipt for this job
        const submittedEvent = findJobSubmittedEvent(receipt, erc8183JobIdBigInt);
        if (!submittedEvent) {
          return eventError(
            'missing_expected_event',
            'submit',
            'submit tx receipt does not contain a matching JobSubmitted event for this job.',
          );
        }

        if (job.deliverableHash && !sameHex(submittedEvent.deliverable, job.deliverableHash)) {
          return NextResponse.json(
            {
              ok: false,
              ...escrowRail(),
              error: 'event_deliverable_mismatch',
              txType: 'submit',
              expectedDeliverable: job.deliverableHash,
              eventDeliverable: submittedEvent.deliverable,
            },
            { status: 422 },
          );
        }

        const onchainJob = await readOnchainJob(erc8183JobIdBigInt);
        if (!onchainJob) {
          return NextResponse.json(
            { ok: false, ...escrowRail(), error: 'onchain_job_not_found', message: 'Job not found on-chain after submit tx.' },
            { status: 422 },
          );
        }

        // Provenance: validate on-chain job matches local job
        const submitProvenanceError = validateOnchainJobMatch(onchainJob, job, 'submit');
        if (submitProvenanceError) return submitProvenanceError;

        await attachErc8183SubmitTx({
          localJobId: params.localJobId,
          submitTxHash: txHash,
          erc8183Status: onchainJob.erc8183Status,
          status: 'submitted',
        });

        return NextResponse.json({
          ok: true,
          ...escrowRail(),
          localJobId: params.localJobId,
          erc8183JobId: job.erc8183JobId,
          txType: 'submit',
          txHash,
          erc8183Status: onchainJob.erc8183Status,
          onchainStatus: onchainJob.status,
          blockNumber: Number(receipt.blockNumber),
          message: 'Submit confirmed. Proceed to POST /api/erc8183-jobs/[localJobId]/complete.',
        });
      }

      case 'complete': {
        // Require JobCompleted event in receipt for this job
        const completedEvent = findJobCompletedEvent(receipt, erc8183JobIdBigInt);
        if (!completedEvent) {
          return eventError(
            'missing_expected_event',
            'complete',
            'complete tx receipt does not contain a matching JobCompleted event for this job.',
          );
        }

        if (job.reasonHash && !sameHex(completedEvent.reason, job.reasonHash)) {
          return NextResponse.json(
            {
              ok: false,
              ...escrowRail(),
              error: 'event_reason_mismatch',
              txType: 'complete',
              expectedReason: job.reasonHash,
              eventReason: completedEvent.reason,
            },
            { status: 422 },
          );
        }

        const onchainJob = await readOnchainJob(erc8183JobIdBigInt);
        if (!onchainJob) {
          return NextResponse.json(
            { ok: false, ...escrowRail(), error: 'onchain_job_not_found', message: 'Job not found on-chain after complete tx.' },
            { status: 422 },
          );
        }

        // Provenance: validate on-chain job matches local job
        const completeProvenanceError = validateOnchainJobMatch(onchainJob, job, 'complete');
        if (completeProvenanceError) return completeProvenanceError;

        await attachErc8183CompleteTx({
          localJobId: params.localJobId,
          completeTxHash: txHash,
          erc8183Status: onchainJob.erc8183Status,
        });

        return NextResponse.json({
          ok: true,
          ...escrowRail(),
          localJobId: params.localJobId,
          erc8183JobId: job.erc8183JobId,
          txType: 'complete',
          txHash,
          erc8183Status: onchainJob.erc8183Status,
          onchainStatus: onchainJob.status,
          blockNumber: Number(receipt.blockNumber),
          message: 'Complete confirmed. Job escrow settled on-chain.',
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'tx_confirmation_failed', message },
      { status: 500 },
    );
  }
}
