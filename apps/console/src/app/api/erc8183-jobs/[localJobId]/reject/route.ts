/**
 * POST /api/erc8183-jobs/[localJobId]/reject
 *
 * Evaluator reject flow for ERC-8183 jobs.
 * Signs and sends the on-chain reject tx, stores result, fires reputation.
 *
 * Contract: reject(uint256 jobId, bytes32 reason, bytes optParams)
 * Runtime target: 0x0747EEf0706327138c69792bF28Cd525089e4583 (proxy)
 */

import { NextRequest, NextResponse } from 'next/server';
import { keccak256, toBytes, isHex, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet, CONTRACTS } from '@arclayer/sdk';
import {
  getErc8183JobByLocalId,
  attachErc8183RejectTx,
  claimErc8183Reject,
  markErc8183RejectFailed,
} from '@/lib/erc8183-jobs/store';
import { assertErc8183Participant, isErc8183Admin } from '@/lib/erc8183-jobs/authz';
import { readOnchainJob, getArcPublicClient } from '@/lib/erc8183-jobs/receipt';
import { escrowRail } from '@/lib/rails/responses';
import { checkMemoryRateLimit } from '@/lib/rate-limit/memory';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { writeReputationFeedback, extractAgentTokenId } from '@/lib/a2a/reputation';
import { ERC8183_ABI } from '@/lib/contracts/erc8183';
import { normalizePrivateKey } from '@/lib/a2a/utils';

const MAX_REASON_LENGTH = 2000;

/**
 * POST /api/erc8183-jobs/[localJobId]/reject
 *
 * Body: { reasonText: string, optParams?: string }
 *
 * 1. Authenticate evaluator API key
 * 2. Load local ERC-8183 job
 * 3. Verify caller is evaluator for this job
 * 4. Verify job is Submitted (pending evaluation)
 * 5. Atomic local claim (race guard)
 * 6. Validate + hash reasonText
 * 7. Call reject on-chain
 * 8. Store reject result
 * 9. Fire-and-forget reputation write (-50 to provider)
 * 10. Return reject tx hash and local job status
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ localJobId: string }> },
) {
  const { localJobId } = await params;
  let claimed = false;

  try {
    // Step 1: Authenticate evaluator API key
    const auth = await requireApiKey(req, API_KEY_SCOPES.ERC8183_REJECT);
    if (auth.error) return auth.error;

    // Step 2: Load local ERC-8183 job
    const job = await getErc8183JobByLocalId(localJobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'job_not_found', message: 'ERC-8183 job not found.' },
        { status: 404 },
      );
    }

    // Guard: erc8183_job_id must exist (createJob confirmed first)
    if (!job.erc8183JobId) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'create_job_pending', message: 'createJob tx must be confirmed first.' },
        { status: 400 },
      );
    }

    // Step 3: Verify caller is evaluator for this job
    if (!isErc8183Admin(auth.key.scopes)) {
      const txAuthError = assertErc8183Participant(job, auth, ['evaluator']);
      if (txAuthError) return txAuthError;
    }

    // Step 4: Verify job is Submitted (pending evaluation)
    if (job.erc8183Status !== 'Submitted') {
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'invalid_status_for_reject',
          currentStatus: job.erc8183Status,
          message: `Job must be in Submitted status to reject. Current status: ${job.erc8183Status ?? 'Unknown'}`,
        },
        { status: 422 },
      );
    }

    // Guard: cannot reject already rejected/completed jobs
    if (job.status === 'rejected' || job.status === 'settled' || job.status === 'rejecting') {
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'job_already_finalized',
          currentStatus: job.status,
          message: `Job is already ${job.status}. Cannot reject.`,
        },
        { status: 422 },
      );
    }

    // Read body — handle invalid JSON as 400
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'invalid_json',
          message: 'Request body must be valid JSON.',
        },
        { status: 400 },
      );
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: 'invalid_body', detail: 'Request body must be a JSON object' },
        { status: 400, headers: { 'Cache-Control': 'no-store, no-cache, max-age=0' } },
      );
    }

    // Step 5: Require reasonText + validate length
    const bodyObj = body as Record<string, unknown>;
    const reasonText = bodyObj.reasonText as string | undefined;
    if (!reasonText || typeof reasonText !== 'string' || reasonText.trim().length === 0) {
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'missing_reason_text',
          message: 'reasonText is required and must be a non-empty string.',
        },
        { status: 400 },
      );
    }

    const trimmedReason = reasonText.trim();
    if (trimmedReason.length > MAX_REASON_LENGTH) {
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'reason_text_too_long',
          message: `reasonText must be ${MAX_REASON_LENGTH} characters or less. Got ${trimmedReason.length}.`,
        },
        { status: 400 },
      );
    }

    // Validate optParams must be hex
    const optParams = typeof bodyObj.optParams === 'string' ? bodyObj.optParams : '0x';
    if (!isHex(optParams)) {
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'invalid_opt_params',
          message: 'optParams must be a 0x-prefixed hex string.',
        },
        { status: 400 },
      );
    }

    // Rate limit: 10 reject attempts per 5 minutes per key + job
    const rateLimit = checkMemoryRateLimit({
      key: ['erc8183_reject', auth.key.id, auth.key.agentId, localJobId].join(':'),
      limit: 10,
      windowMs: 5 * 60 * 1000,
    });

    if (!rateLimit.ok) {
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'rate_limited',
          message: 'Too many reject attempts. Retry after the reset time.',
          limit: rateLimit.limit,
          remaining: rateLimit.remaining,
          resetAt: new Date(rateLimit.resetAt).toISOString(),
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
            'X-RateLimit-Limit': String(rateLimit.limit),
            'X-RateLimit-Remaining': String(rateLimit.remaining),
            'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
          },
        },
      );
    }

    // Step 5b: Atomic local claim — prevents double-reject race
    try {
      claimed = await claimErc8183Reject({ localJobId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[reject] claimErc8183Reject failed for job ${localJobId}:`, message);
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'claim_failed', message },
        { status: 500 },
      );
    }

    if (!claimed) {
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'reject_already_in_progress_or_finalized',
          message: 'Reject is already in progress or job is no longer rejectable.',
        },
        { status: 409 },
      );
    }

    // Step 6: Create canonical reason hash
    const canonicalPayload = {
      localJobId,
      erc8183JobId: job.erc8183JobId,
      providerAgentId: job.providerAgentId,
      evaluatorAgentId: job.evaluatorAgentId,
      deliverableHash: job.deliverableHash ?? null,
      decision: 'reject',
      reasonText: trimmedReason,
    };
    const reasonHash = keccak256(toBytes(JSON.stringify(canonicalPayload)));

    // Step 7: Call reject on-chain
    const evaluatorPk = normalizePrivateKey(
      process.env.ERC8183_EVALUATOR_PRIVATE_KEY ||
      process.env.EVALUATOR_BOT_PK,
    );

    if (!evaluatorPk) {
      // Rollback claim before returning
      await markErc8183RejectFailed({ localJobId }).catch(() => {});
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'missing_evaluator_key',
          message: 'Server is not configured with an evaluator private key. Set ERC8183_EVALUATOR_PRIVATE_KEY.',
        },
        { status: 503 },
      );
    }

    const account = privateKeyToAccount(evaluatorPk);

    // Signer mismatch guard — evaluator PK must match job evaluator address
    if (job.evaluatorAddress && account.address.toLowerCase() !== job.evaluatorAddress.toLowerCase()) {
      await markErc8183RejectFailed({ localJobId }).catch(() => {});
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'evaluator_signer_mismatch',
          message: 'Configured evaluator private key does not match this job evaluator address.',
        },
        { status: 503 },
      );
    }

    const walletClient = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(process.env.ARC_RPC_URL),
    });

    const erc8183JobIdBigInt = BigInt(job.erc8183JobId);

    // Verify on-chain job is in Submitted status before sending reject
    let onchainJob;
    try {
      onchainJob = await readOnchainJob(erc8183JobIdBigInt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[reject] readOnchainJob failed for job ${localJobId}:`, message);
      await markErc8183RejectFailed({ localJobId }).catch(() => {});
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'onchain_read_failed', message },
        { status: 502 },
      );
    }

    if (!onchainJob) {
      await markErc8183RejectFailed({ localJobId }).catch(() => {});
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'onchain_job_not_found',
          message: 'Job not found on-chain.',
        },
        { status: 422 },
      );
    }

    if (onchainJob.erc8183Status !== 'Submitted') {
      await markErc8183RejectFailed({ localJobId }).catch(() => {});
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'onchain_status_mismatch',
          onchainStatus: onchainJob.erc8183Status,
          message: `On-chain job status is ${onchainJob.erc8183Status}, expected Submitted.`,
        },
        { status: 422 },
      );
    }

    // Send the reject tx
    let rejectTxHash: Hex;
    try {
      rejectTxHash = await walletClient.writeContract({
        address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
        abi: ERC8183_ABI,
        functionName: 'reject',
        args: [erc8183JobIdBigInt, reasonHash as Hex, optParams as Hex],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[reject] writeContract failed for job ${localJobId}:`, message);
      await markErc8183RejectFailed({ localJobId }).catch(() => {});
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'reject_tx_failed',
          message: `Failed to send reject transaction: ${message}`,
        },
        { status: 502 },
      );
    }

    // Wait for tx receipt
    const publicClient = getArcPublicClient();
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({
        hash: rejectTxHash,
        confirmations: 1,
        timeout: 60_000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[reject] waitForTransactionReceipt failed for job ${localJobId}:`, message);
      await markErc8183RejectFailed({ localJobId }).catch(() => {});
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'reject_receipt_failed',
          rejectTxHash,
          message: `Reject tx sent but receipt failed: ${message}`,
        },
        { status: 502 },
      );
    }

    if (receipt.status !== 'success') {
      await markErc8183RejectFailed({ localJobId }).catch(() => {});
      return NextResponse.json(
        {
          ok: false,
          ...escrowRail(),
          error: 'reject_tx_reverted',
          rejectTxHash,
          message: 'Reject transaction reverted on-chain.',
        },
        { status: 422 },
      );
    }

    // Step 8: Store reject tx hash, reason, status
    try {
      await attachErc8183RejectTx({
        localJobId,
        rejectTxHash,
        rejectReasonText: trimmedReason,
        rejectReasonHash: reasonHash,
      });
    } catch (err) {
      // Idempotent — if already stored with same hash, that's fine
      if (err instanceof Error && err.message.includes('IDEMPOTENT')) {
        // Continue — already stored
      } else {
        console.error(`[reject] attachErc8183RejectTx failed for job ${localJobId}:`, err);
        // Don't fail the response — tx was already sent on-chain
      }
    }

    // Step 9: Fire-and-forget reputation write (-50 to provider)
    const providerAgentId = job.providerAgentId;
    if (providerAgentId) {
      const agentTokenId = extractAgentTokenId(providerAgentId);
      if (agentTokenId) {
        writeReputationFeedback({
          agentTokenId,
          score: -50,
          category: 2,
          comment: 'erc8183_job_rejected',
          metadataURI: `arclayer://jobs/${encodeURIComponent(localJobId)}`,
          proofURI: `arclayer://proof/job-reject/${encodeURIComponent(localJobId)}`,
          context: 'erc8183_job_rejected',
          jobId: localJobId,
        }).catch((err) => {
          console.error(
            `[reject] reputation write failed for provider ${providerAgentId}, job ${localJobId}:`,
            err instanceof Error ? err.message : err,
          );
        });
      } else {
        console.warn(
          `[reject] could not extract tokenId from providerAgentId=${providerAgentId}, jobId=${localJobId}`,
        );
      }
    }

    // Step 10: Return reject tx hash and local job status
    return NextResponse.json({
      ok: true,
      ...escrowRail(),
      localJobId,
      erc8183JobId: job.erc8183JobId,
      rejectTxHash,
      reasonHash,
      erc8183Status: 'Rejected',
      status: 'rejected',
      blockNumber: Number(receipt.blockNumber),
      message: 'Job rejected successfully.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[reject] unexpected error for job ${localJobId}:`, message);
    // Rollback claim if we claimed but hit unexpected error
    if (claimed) {
      await markErc8183RejectFailed({ localJobId }).catch(() => {});
    }
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'reject_failed', message },
      { status: 500 },
    );
  }
}
