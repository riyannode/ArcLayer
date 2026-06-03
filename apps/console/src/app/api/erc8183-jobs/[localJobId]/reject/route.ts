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
import { keccak256, toBytes, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from '@arclayer/sdk';
import { getErc8183JobByLocalId, attachErc8183RejectTx } from '@/lib/erc8183-jobs/store';
import { assertErc8183Participant, isErc8183Admin } from '@/lib/erc8183-jobs/authz';
import { readOnchainJob, getArcPublicClient } from '@/lib/erc8183-jobs/receipt';
import { escrowRail } from '@/lib/rails/responses';
import { checkMemoryRateLimit } from '@/lib/rate-limit/memory';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { writeReputationFeedback, extractAgentTokenId } from '@/lib/a2a/reputation';
import { ERC8183_ABI } from '@/lib/contracts/erc8183';
import { normalizePrivateKey } from '@/lib/a2a/utils';
import { CONTRACTS } from '@arclayer/sdk';

/**
 * POST /api/erc8183-jobs/[localJobId]/reject
 *
 * Body: { reasonText: string, optParams?: string }
 *
 * 1. Authenticate evaluator API key
 * 2. Load local ERC-8183 job
 * 3. Verify caller is evaluator for this job
 * 4. Verify job is Submitted (pending evaluation)
 * 5. Require reasonText
 * 6. Create reasonHash = keccak256(toBytes(reasonText))
 * 7. Call reject(onchainJobId, reasonHash, optParams) on proxy
 * 8. Store reject tx hash, reason, status
 * 9. Fire-and-forget reputation write (-50 to provider)
 * 10. Return reject tx hash and local job status
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ localJobId: string }> },
) {
  const { localJobId } = await params;
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
    if (job.status === 'rejected' || job.status === 'settled') {
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

    // Read body
    const body = await req.json();

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: 'invalid_body', detail: 'Request body must be a JSON object' },
        { status: 400, headers: { 'Cache-Control': 'no-store, no-cache, max-age=0' } },
      );
    }

    // Step 5: Require reasonText
    const reasonText = body.reasonText as string | undefined;
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

    const optParams = (body.optParams as string) || '0x';

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

    // Step 6: Create reasonHash = keccak256(toBytes(reasonText))
    const reasonHash = keccak256(toBytes(reasonText.trim()));

    // Step 7: Call reject(onchainJobId, reasonHash, optParams) on proxy
    const evaluatorPk = normalizePrivateKey(
      process.env.ERC8183_EVALUATOR_PRIVATE_KEY ||
      process.env.EVALUATOR_BOT_PK ||
      process.env.REPUTATION_FEEDBACK_PRIVATE_KEY,
    );

    if (!evaluatorPk) {
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
    const walletClient = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(process.env.ARC_RPC_URL),
    });

    const erc8183JobIdBigInt = BigInt(job.erc8183JobId);

    // Verify on-chain job is in Submitted status before sending reject
    const onchainJob = await readOnchainJob(erc8183JobIdBigInt);
    if (!onchainJob) {
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
        rejectReasonText: reasonText.trim(),
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
          category: 1,
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
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'reject_failed', message },
      { status: 500 },
    );
  }
}
