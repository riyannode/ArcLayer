import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import {
  getErc8183JobByLocalId,
  attachErc8183CreateTx,
} from '@/lib/erc8183-jobs/store';
import { assertErc8183Participant } from '@/lib/erc8183-jobs/authz';
import {
  readTransactionReceipt,
  decodeJobCreatedFromReceipt,
} from '@/lib/erc8183-jobs/receipt';
import { escrowRail } from '@/lib/rails/responses';
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
 *   3. Decode JobCreated event (mandatory)
 *   4. Validate decoded event fields match local job
 *   5. Update erc8183_status = 'Open' + store erc8183_job_id + create_tx_hash
 */
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

    // Guard: only the buyer can confirm the on-chain createJob tx
    const createdAuthError = assertErc8183Participant(job, auth, ['buyer']);
    if (createdAuthError) return createdAuthError;

    // Prevent re-attaching if already confirmed
    if (job.erc8183JobId) {
      return humanJson(req, {
        ok: true,
        ...escrowRail(),
        localJobId: localJobId,
        erc8183JobId: job.erc8183JobId,
        createTxHash: job.createTxHash,
        message: 'createJob tx already confirmed.',
      });
    }

    const body = await req.json();
    const createTxHash = body.createTxHash as Hex | undefined;

    if (!createTxHash || typeof createTxHash !== 'string' || !createTxHash.startsWith('0x')) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'invalid_tx_hash', message: 'Valid createTxHash (0x-prefixed) is required.' }, { status: 400 });
    }

    // Step 1: read transaction receipt
    const receipt = await readTransactionReceipt(createTxHash);
    if (!receipt) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'tx_not_found', message: 'Transaction not found. It may not have been mined yet. Retry after a few seconds.' }, { status: 202 });
    }

    // Step 2: confirm receipt success
    if (receipt.status !== 'success') {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'tx_reverted', message: 'createJob transaction reverted on-chain.' }, { status: 422 });
    }

    // Step 3: decode JobCreated event (mandatory)
    const decodedEvent = decodeJobCreatedFromReceipt(receipt);
    if (!decodedEvent) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'job_created_event_not_found', message: 'Could not decode JobCreated event from receipt logs. Verify the tx was sent to the correct AgenticCommerce contract.' }, { status: 422 });
    }

    const erc8183JobId = decodedEvent.jobId.toString();

    // Step 4: validate decoded event fields match the local job
    const localClient = (job.clientAddress ?? '').toLowerCase();
    const decodedClient = decodedEvent.client.toLowerCase();
    if (localClient && decodedClient !== localClient) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'event_client_mismatch',
          message: `Decoded JobCreated.client ${decodedClient} does not match local job client ${localClient}.`,
        }, { status: 422 });
    }

    const localProvider = (job.providerAddress ?? '').toLowerCase();
    const decodedProvider = decodedEvent.provider.toLowerCase();
    if (localProvider && decodedProvider !== localProvider) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'event_provider_mismatch',
          message: `Decoded JobCreated.provider ${decodedProvider} does not match local job provider ${localProvider}.`,
        }, { status: 422 });
    }

    const localEval = (job.evaluatorAddress ?? '').toLowerCase();
    const decodedEval = decodedEvent.evaluator.toLowerCase();
    const zeroAddress = '0x0000000000000000000000000000000000000000';
    if (localEval && decodedEval !== localEval && decodedEval !== zeroAddress) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'event_evaluator_mismatch',
          message: `Decoded JobCreated.evaluator ${decodedEval} does not match local job evaluator ${localEval} or zero address.`,
        }, { status: 422 });
    }

    const localExpiredAt = job.expiredAtUnix ? BigInt(job.expiredAtUnix) : null;
    if (localExpiredAt !== null && decodedEvent.expiredAt !== localExpiredAt) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'event_expired_at_mismatch',
          message: `Decoded JobCreated.expiredAt ${decodedEvent.expiredAt} does not match local job expiredAt ${localExpiredAt}.`,
        }, { status: 422 });
    }

    const localHook = (job.hookAddress ?? '0x0000000000000000000000000000000000000000').toLowerCase();
    const decodedHook = decodedEvent.hook.toLowerCase();
    if (decodedHook !== localHook) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'event_hook_mismatch',
          message: `Decoded JobCreated.hook ${decodedHook} does not match local job hook ${localHook}.`,
        }, { status: 422 });
    }

    // Step 5: store results
    await attachErc8183CreateTx({
      localJobId: localJobId,
      createTxHash,
      erc8183JobId,
    });

    return humanJson(req, {
      ok: true,
      ...escrowRail(),
      localJobId: localJobId,
      erc8183JobId,
      erc8183Status: 'Open',
      createTxHash,
      blockNumber: Number(receipt.blockNumber),
      message: 'createJob confirmed. Proceed to POST /api/erc8183-jobs/[localJobId]/set-budget.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return humanJson(req, { ok: false, ...escrowRail(), error: 'confirm_create_failed', message }, { status: 500 });
  }
}
