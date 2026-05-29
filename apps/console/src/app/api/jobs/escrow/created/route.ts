import { NextRequest, NextResponse } from 'next/server';
import {
  getErc8183JobByLocalId,
  attachErc8183CreateTx,
} from '@/lib/erc8183-jobs/store';
import {
  readTransactionReceipt,
  decodeJobCreatedFromReceipt,
} from '@/lib/erc8183-jobs/receipt';
import { escrowRail } from '@/lib/rails/responses';
import type { Hex } from 'viem';

/**
 * POST /api/jobs/escrow/created
 *
 * Console-only wrapper for confirming a createJob tx.
 * No API key required — mirrors the logic of
 * POST /api/erc8183-jobs/[localJobId]/created but without
 * external auth, so the browser can call it directly.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const localJobId = body.localJobId as string | undefined;
    const createTxHash = body.createTxHash as Hex | undefined;

    if (!localJobId) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'missing_local_job_id', message: 'localJobId is required.' },
        { status: 400 },
      );
    }

    if (!createTxHash || typeof createTxHash !== 'string' || !createTxHash.startsWith('0x')) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'invalid_tx_hash', message: 'Valid createTxHash (0x-prefixed) is required.' },
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

    // Already confirmed — return early
    if (job.erc8183JobId) {
      return NextResponse.json({
        ok: true,
        ...escrowRail(),
        localJobId,
        erc8183JobId: job.erc8183JobId,
        createTxHash: job.createTxHash,
        message: 'createJob tx already confirmed.',
      });
    }

    // Step 1: read transaction receipt
    const receipt = await readTransactionReceipt(createTxHash);
    if (!receipt) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'tx_not_found', message: 'Transaction not found. It may not have been mined yet. Retry after a few seconds.' },
        { status: 202 },
      );
    }

    // Step 2: confirm receipt success
    if (receipt.status !== 'success') {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'tx_reverted', message: 'createJob transaction reverted on-chain.' },
        { status: 422 },
      );
    }

    // Step 3: decode JobCreated event
    const decodedEvent = decodeJobCreatedFromReceipt(receipt);
    if (!decodedEvent) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'job_created_event_not_found', message: 'Could not decode JobCreated event from receipt logs.' },
        { status: 422 },
      );
    }

    const erc8183JobId = decodedEvent.jobId.toString();

    // Step 4: validate decoded event fields match the local job
    const localClient = (job.clientAddress ?? '').toLowerCase();
    const decodedClient = decodedEvent.client.toLowerCase();
    if (localClient && decodedClient !== localClient) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'event_client_mismatch',
          message: `Decoded JobCreated.client ${decodedClient} does not match local job client ${localClient}.` },
        { status: 422 },
      );
    }

    const localProvider = (job.providerAddress ?? '').toLowerCase();
    const decodedProvider = decodedEvent.provider.toLowerCase();
    if (localProvider && decodedProvider !== localProvider) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'event_provider_mismatch',
          message: `Decoded JobCreated.provider ${decodedProvider} does not match local job provider ${localProvider}.` },
        { status: 422 },
      );
    }

    // Step 5: store results
    await attachErc8183CreateTx({
      localJobId,
      createTxHash,
      erc8183JobId,
    });

    return NextResponse.json({
      ok: true,
      ...escrowRail(),
      localJobId,
      erc8183JobId,
      erc8183Status: 'Open',
      createTxHash,
      blockNumber: Number(receipt.blockNumber),
      message: 'createJob confirmed. Proceed to POST /api/erc8183-jobs/[localJobId]/set-budget.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'confirm_create_failed', message },
      { status: 500 },
    );
  }
}
