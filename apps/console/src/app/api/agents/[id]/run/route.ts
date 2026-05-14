import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, fallback, http, isHash, parseEventLogs } from 'viem';
import { ARC_RPC_URLS, CONTRACTS, JOB_ESCROW_ABI, arcTestnet } from '@arclayer/sdk';
import { runAgent } from '@/lib/agentExecutor';
import {
  createRun,
  getRunByTxHash,
  markCompleted,
  markFailed,
  markSubmitting,
  markSubmitted,
  markSubmitFailed,
} from '@/lib/runStore';
import { submitDeliverableForRun } from '@/lib/jobSubmitter';

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback(ARC_RPC_URLS.map((url) => http(url))),
});

function paymentRequired(agentId: string) {
  return NextResponse.json(
    {
      error: 'payment_required',
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network: 'arc-testnet',
          chainId: arcTestnet.id,
          asset: CONTRACTS.USDC,
          payTo: CONTRACTS.JOB_ESCROW,
          maxAmountRequired: '1000000',
          resource: `/api/agents/${agentId}/run`,
          description: 'Fund a Settlement Vault run with testnet USDC, then retry with X-PAYMENT.',
          mimeType: 'application/json',
        },
      ],
    },
    { status: 402, headers: { 'X-402-Version': '1' } }
  );
}

function rejectPayment(message: string, status = 402) {
  return NextResponse.json(
    { error: 'payment_not_settled', message },
    { status, headers: status === 402 ? { 'X-402-Version': '1' } : {} }
  );
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const agentId = params.id;
  const payment = req.headers.get('x-payment');
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (!payment) return paymentRequired(agentId);

  // Parse X-PAYMENT header — supports raw txHash OR {txHash} JSON.
  let txHash = payment;
  try {
    const parsed = JSON.parse(payment) as { txHash?: string };
    txHash = parsed.txHash || txHash;
  } catch {}

  if (!isHash(txHash)) {
    return NextResponse.json(
      { error: 'invalid_payment', message: 'X-PAYMENT must include a valid txHash.' },
      { status: 400 }
    );
  }

  // 0. Idempotency: if we already ran this payment, return the cached result.
  // Same payment hash = same run. Client retries are safe and cheap.
  const existing = getRunByTxHash(txHash);
  if (existing) {
    return NextResponse.json({
      ok: existing.status === 'submitted' || existing.status === 'completed',
      cached: true,
      agentId: existing.agentId,
      jobId: existing.jobId,
      run: {
        id: existing.id,
        status: existing.status,
        output: existing.output,
        error: existing.errorMessage,
        completedAt: existing.completedAt,
        submittedAt: existing.submittedAt,
      },
      deliverable: existing.deliverableCid
        ? {
            cid: existing.deliverableCid,
            uri: existing.deliverableUri,
            hash: existing.deliverableHash,
          }
        : null,
      proof: existing.proofCid
        ? {
            cid: existing.proofCid,
            uri: existing.proofUri,
          }
        : null,
      onChain: existing.submitTxHash
        ? { submitTxHash: existing.submitTxHash }
        : null,
      payment: {
        chainId: arcTestnet.id,
        txHash,
        payer: existing.payer,
        amount: existing.amount,
      },
    });
  }

  // 1. Fetch receipt — must be successful and target the Settlement Vault.
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) return rejectPayment('Payment tx receipt not found.');
  if (receipt.status !== 'success') return rejectPayment('Payment tx reverted.');
  if (receipt.to?.toLowerCase() !== CONTRACTS.JOB_ESCROW.toLowerCase()) {
    return rejectPayment('Payment tx did not target the Settlement Vault.');
  }

  // 2. Decode JobFunded event — server trusts event log, not client claims.
  const jobFundedLogs = parseEventLogs({
    abi: JOB_ESCROW_ABI,
    eventName: 'JobFunded',
    logs: receipt.logs,
  });

  if (jobFundedLogs.length === 0) {
    return rejectPayment('Payment tx did not emit a JobFunded event.');
  }

  const fundedEvent = jobFundedLogs[0];
  const fundedJobId = fundedEvent.args.jobId;
  const fundedClient = fundedEvent.args.client.toLowerCase();
  const fundedAmount = fundedEvent.args.amount;

  // 3. Cross-check claimed jobId against the event.
  if (body.jobId !== undefined && body.jobId !== null) {
    const claimedJobId = BigInt(String(body.jobId));
    if (claimedJobId !== fundedJobId) {
      return rejectPayment(
        `Payment jobId mismatch: claimed ${claimedJobId.toString()}, funded ${fundedJobId.toString()}.`
      );
    }
  }

  // 4. Minimum price gate.
  const MIN_PRICE = BigInt(1_000_000);
  if (fundedAmount < MIN_PRICE) {
    return rejectPayment(
      `Payment amount ${fundedAmount.toString()} below required ${MIN_PRICE.toString()}.`
    );
  }

  // 5. Persist run as 'running' before invoking the agent.
  const inputRaw = body.input ?? body.prompt ?? null;
  const inputStr =
    typeof inputRaw === 'string'
      ? inputRaw
      : inputRaw == null
        ? ''
        : JSON.stringify(inputRaw);

  const run = createRun({
    jobId: fundedJobId.toString(),
    agentId,
    payer: fundedClient,
    amount: fundedAmount.toString(),
    paymentTxHash: txHash,
    input: inputStr || null,
  });

  // 6. Run the agent inline (B1 = sync mode).
  let result;
  try {
    result = await runAgent({
      agentId,
      jobId: fundedJobId.toString(),
      payer: fundedClient,
      input: inputStr || `(no input provided — agent #${agentId} acknowledges payment)`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed = markFailed(run.id, msg);
    return NextResponse.json(
      {
        ok: false,
        cached: false,
        agentId,
        jobId: failed.jobId,
        run: {
          id: failed.id,
          status: failed.status,
          error: failed.errorMessage,
          completedAt: failed.completedAt,
        },
        payment: {
          chainId: arcTestnet.id,
          txHash,
          payer: failed.payer,
          amount: failed.amount,
        },
      },
      { status: 502 }
    );
  }

  const completed = markCompleted(run.id, result.output);

  // 7. (B2) Submit deliverable on chain. Off-chain output is now committed
  //        to IPFS and JobEscrow.submitDeliverable is called from the
  //        service worker key. Mode A: same key for all agents.
  //
  //        Failure here does NOT roll back the LLM run — the buyer paid,
  //        agent ran, output is stored. We mark `submit_failed` and let
  //        the buyer call POST /api/jobs/:id/submit to retry.
  markSubmitting(run.id);
  try {
    const sub = await submitDeliverableForRun({
      jobId: fundedJobId,
      agentId,
      runId: run.id,
      input: inputStr || '',
      output: result.output,
      model: result.model,
      tokensUsed: result.tokensUsed,
      latencyMs: result.latencyMs,
      startedAt: completed.createdAt,
      completedAt: completed.completedAt ?? Date.now(),
    });
    const submitted = markSubmitted(run.id, {
      deliverableCid: sub.deliverableCid,
      deliverableUri: sub.deliverableUri,
      deliverableHash: sub.deliverableHash,
      proofCid: sub.proofCid,
      proofUri: sub.proofUri,
      submitTxHash: sub.txHash,
    });

    return NextResponse.json({
      ok: true,
      cached: false,
      agentId,
      jobId: submitted.jobId,
      run: {
        id: submitted.id,
        status: submitted.status,
        output: submitted.output,
        model: result.model,
        tokensUsed: result.tokensUsed,
        latencyMs: result.latencyMs,
        completedAt: submitted.completedAt,
        submittedAt: submitted.submittedAt,
      },
      deliverable: {
        cid: submitted.deliverableCid,
        uri: submitted.deliverableUri,
        hash: submitted.deliverableHash,
      },
      proof: {
        cid: submitted.proofCid,
        uri: submitted.proofUri,
      },
      onChain: {
        submitTxHash: submitted.submitTxHash,
        blockNumber: sub.blockNumber.toString(),
      },
      payment: {
        chainId: arcTestnet.id,
        txHash,
        payer: submitted.payer,
        amount: submitted.amount,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const submitFailed = markSubmitFailed(run.id, msg);
    return NextResponse.json(
      {
        ok: false,
        cached: false,
        agentId,
        jobId: submitFailed.jobId,
        run: {
          id: submitFailed.id,
          status: submitFailed.status,           // 'submit_failed'
          output: submitFailed.output,           // LLM output preserved
          error: submitFailed.errorMessage,
          completedAt: submitFailed.completedAt,
        },
        retryable: true,
        retryUrl: `/api/jobs/${submitFailed.jobId}/submit`,
        payment: {
          chainId: arcTestnet.id,
          txHash,
          payer: submitFailed.payer,
          amount: submitFailed.amount,
        },
      },
      { status: 502 }
    );
  }
}
