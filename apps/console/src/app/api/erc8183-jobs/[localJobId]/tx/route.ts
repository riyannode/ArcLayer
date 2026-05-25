import { NextRequest, NextResponse } from 'next/server';
import { getErc8183JobByLocalId } from '@/lib/erc8183-jobs/store';
import {
  readTransactionReceipt,
  readOnchainJob,
} from '@/lib/erc8183-jobs/receipt';
import {
  attachErc8183SetBudgetTx,
  attachErc8183ApproveTx,
  attachErc8183FundTx,
  attachErc8183SubmitTx,
  attachErc8183CompleteTx,
  updateErc8183Status,
} from '@/lib/erc8183-jobs/store';
import type { Hex } from 'viem';

type TxType = 'set_budget' | 'approve' | 'fund' | 'submit' | 'complete';

const VALID_TX_TYPES: TxType[] = ['set_budget', 'approve', 'fund', 'submit', 'complete'];

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
        { ok: false, error: 'create_job_pending', message: 'createJob tx must be confirmed first. POST /api/erc8183-jobs/[localJobId]/created.' },
        { status: 400 },
      );
    }

    const body = await req.json();
    const txType = body.tx_type as TxType | undefined;
    const txHash = body.tx_hash as Hex | undefined;

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
        // set_budget: on-chain status stays 'Open', just store tx hash
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
        // approve: on-chain status stays same, just store tx hash
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
