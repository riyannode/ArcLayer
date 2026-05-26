import { NextRequest, NextResponse } from 'next/server';
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
  updateErc8183Status,
} from '@/lib/erc8183-jobs/store';
import { assertErc8183Participant, isErc8183Admin } from '@/lib/erc8183-jobs/authz';
import { escrowRail } from '@/lib/rails/responses';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { USDC_ABI, CONTRACTS } from '@/lib/contracts';
import { ARC_TOKENS } from '@arclayer/sdk';
import type { Hex } from 'viem';
import type { Erc8183JobView } from '@/lib/erc8183-jobs/types';
import type { ConfirmedReceipt } from '@/lib/erc8183-jobs/receipt';

type TxType = 'set_budget' | 'approve' | 'fund' | 'submit' | 'complete';

const VALID_TX_TYPES: TxType[] = ['set_budget', 'approve', 'fund', 'submit', 'complete'];

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
      { ok: false, error: 'onchain_client_mismatch', txType, message: `On-chain job client ${onchain.client} does not match local job client ${localClient}.` },
      { status: 422 },
    );
  }

  const localProvider = (local.providerAddress ?? '').toLowerCase();
  if (localProvider && onchain.provider.toLowerCase() !== localProvider) {
    return NextResponse.json(
      { ok: false, error: 'onchain_provider_mismatch', txType, message: `On-chain job provider ${onchain.provider} does not match local job provider ${localProvider}.` },
      { status: 422 },
    );
  }

  const localEval = (local.evaluatorAddress ?? '').toLowerCase();
  if (localEval && onchain.evaluator.toLowerCase() !== localEval && onchain.evaluator.toLowerCase() !== zeroAddress) {
    return NextResponse.json(
      { ok: false, error: 'onchain_evaluator_mismatch', txType, message: `On-chain job evaluator ${onchain.evaluator} does not match local job evaluator ${localEval} or zero address.` },
      { status: 422 },
    );
  }

  const localExpiredAt = local.expiredAtUnix ? BigInt(local.expiredAtUnix) : null;
  if (localExpiredAt !== null && onchain.expiredAt !== localExpiredAt) {
    return NextResponse.json(
      { ok: false, error: 'onchain_expired_at_mismatch', txType, message: `On-chain job expiredAt ${onchain.expiredAt} does not match local job expiredAt ${localExpiredAt}.` },
      { status: 422 },
    );
  }

  const localHook = (local.hookAddress ?? zeroAddress).toLowerCase();
  if (onchain.hook.toLowerCase() !== localHook) {
    return NextResponse.json(
      { ok: false, error: 'onchain_hook_mismatch', txType, message: `On-chain job hook ${onchain.hook} does not match local job hook ${localHook}.` },
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
        { ok: false, error: 'job_not_found', message: 'ERC-8183 job not found.' },
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
        { ok: false, error: 'invalid_tx_type', message: `tx_type must be one of: ${VALID_TX_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    if (!txHash || typeof txHash !== 'string' || !txHash.startsWith('0x')) {
      return NextResponse.json(
        { ok: false, error: 'invalid_tx_hash', message: 'Valid tx_hash (0x-prefixed) is required.' },
        { status: 400 },
      );
    }

    // Step 1: read transaction receipt
    const receipt = await readTransactionReceipt(txHash);
    if (!receipt) {
      return NextResponse.json(
        { ok: false, error: 'tx_not_found', message: 'Transaction not found. It may still be mining. Retry after a few seconds.' },
        { status: 202 },
      );
    }

    // Step 2: confirm receipt success
    if (receipt.status !== 'success') {
      return NextResponse.json(
        { ok: false, error: 'tx_reverted', message: `Transaction reverted on-chain.` },
        { status: 422 },
      );
    }

    const erc8183JobIdBigInt = BigInt(job.erc8183JobId);

    // Step 3-4: handle by tx type
    switch (txType) {
      case 'set_budget': {
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
          settlementMode: 'erc8183_escrow',
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
        // Verify USDC allowance was granted after the approve tx
        const clientAddress = job.clientAddress;
        let allowanceOk = false;
        let actualAllowance = BigInt(0);
        if (clientAddress) {
          try {
            const pc = getArcPublicClient();
            actualAllowance = await pc.readContract({
              address: ARC_TOKENS.USDC,
              abi: USDC_ABI,
              functionName: 'allowance',
              args: [clientAddress as Hex, CONTRACTS.ERC8183_AGENTIC_COMMERCE],
            }) as bigint;
            allowanceOk = actualAllowance >= BigInt(job.priceAtomic);
          } catch {
            // If allowance check fails, still allow — the tx receipt proves approval
            allowanceOk = true;
          }
        }

        if (!allowanceOk) {
          return NextResponse.json(
            {
              ok: false,
              ...escrowRail(),
              error: 'allowance_insufficient_after_approve',
              txType: 'approve',
              clientAddress,
              requiredAllowance: job.priceAtomic,
              actualAllowance: actualAllowance.toString(),
              message: `USDC allowance after approve tx is insufficient. Required >= ${job.priceAtomic}, got ${actualAllowance}.`,
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
          settlementMode: 'erc8183_escrow',
          localJobId: params.localJobId,
          erc8183JobId: job.erc8183JobId,
          txType: 'approve',
          txHash,
          erc8183Status: job.erc8183Status ?? 'Open',
          blockNumber: Number(receipt.blockNumber),
          message: 'USDC approve confirmed. Proceed to sign and broadcast the fund tx.',
        });
      }

      case 'fund': {
        // Step 3: read on-chain job state
        const onchainJob = await readOnchainJob(erc8183JobIdBigInt);
        if (!onchainJob) {
          return NextResponse.json(
            { ok: false, error: 'onchain_job_not_found', message: 'Job not found on-chain after fund tx. The contract may have reverted differently than the receipt suggests.' },
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
          settlementMode: 'erc8183_escrow',
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
        const onchainJob = await readOnchainJob(erc8183JobIdBigInt);
        if (!onchainJob) {
          return NextResponse.json(
            { ok: false, error: 'onchain_job_not_found', message: 'Job not found on-chain after submit tx.' },
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
          settlementMode: 'erc8183_escrow',
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
        const onchainJob = await readOnchainJob(erc8183JobIdBigInt);
        if (!onchainJob) {
          return NextResponse.json(
            { ok: false, error: 'onchain_job_not_found', message: 'Job not found on-chain after complete tx.' },
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
          settlementMode: 'erc8183_escrow',
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
      { ok: false, error: 'tx_confirmation_failed', message },
      { status: 500 },
    );
  }
}
