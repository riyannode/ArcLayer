import { NextRequest, NextResponse } from 'next/server';
import { getErc8183JobByLocalId, attachErc8183CreateTx } from '@/lib/erc8183-jobs/store';
import {
  readTransactionReceipt,
  decodeJobCreatedFromReceipt,
} from '@/lib/erc8183-jobs/receipt';
import type { Hex } from 'viem';

/**
 * POST /api/erc8183-jobs/[localJobId]/created
 *
 * Attaches the createJob tx hash, reads the receipt,
 * decodes the JobCreated event, and stores the on-chain erc8183_job_id.
 *
 * Per plan Correction 6:
 *   1. Read transaction receipt
 *   2. Confirm receipt status = success
 *   3. Decode JobCreated event (mandatory for 'created' — not optional)
 *   4. Update erc8183_status = 'Open' + store erc8183_job_id + create_tx_hash
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

    // Prevent re-attaching if already confirmed
    if (job.erc8183JobId) {
      return NextResponse.json({
        ok: true,
        settlementMode: 'erc8183_escrow',
        localJobId: params.localJobId,
        erc8183JobId: job.erc8183JobId,
        createTxHash: job.createTxHash,
        message: 'createJob tx already confirmed.',
      });
    }

    const body = await req.json();
    const createTxHash = body.createTxHash as Hex | undefined;

    if (!createTxHash || typeof createTxHash !== 'string' || !createTxHash.startsWith('0x')) {
      return NextResponse.json(
        { ok: false, error: 'invalid_tx_hash', message: 'Valid createTxHash (0x-prefixed) is required.' },
        { status: 400 },
      );
    }

    // Step 1: read transaction receipt
    const receipt = await readTransactionReceipt(createTxHash);
    if (!receipt) {
      return NextResponse.json(
        { ok: false, error: 'tx_not_found', message: 'Transaction not found. It may not have been mined yet. Retry after a few seconds.' },
        { status: 202 },
      );
    }

    // Step 2: confirm receipt success
    if (receipt.status !== 'success') {
      return NextResponse.json(
        { ok: false, error: 'tx_reverted', message: 'createJob transaction reverted on-chain.' },
        { status: 422 },
      );
    }

    // Step 3: decode JobCreated event (mandatory)
    const decodedEvent = decodeJobCreatedFromReceipt(receipt);
    if (!decodedEvent) {
      return NextResponse.json(
        { ok: false, error: 'job_created_event_not_found', message: 'Could not decode JobCreated event from receipt logs. Verify the tx was sent to the correct AgenticCommerce contract.' },
        { status: 422 },
      );
    }

    const erc8183JobId = decodedEvent.jobId.toString();

    // Step 4: store results
    await attachErc8183CreateTx({
      localJobId: params.localJobId,
      createTxHash,
      erc8183JobId,
    });

    return NextResponse.json({
      ok: true,
      settlementMode: 'erc8183_escrow',
      localJobId: params.localJobId,
      erc8183JobId,
      erc8183Status: 'Open',
      createTxHash,
      blockNumber: Number(receipt.blockNumber),
      message: 'createJob confirmed. Proceed to POST /api/erc8183-jobs/[localJobId]/set-budget.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'confirm_create_failed', message },
      { status: 500 },
    );
  }
}
