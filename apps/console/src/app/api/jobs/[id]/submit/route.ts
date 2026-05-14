import { NextRequest, NextResponse } from 'next/server';
import {
  listRunsByJob,
  markSubmitting,
  markSubmitted,
  markSubmitFailed,
} from '@/lib/runStore';
import { submitDeliverableForRun } from '@/lib/jobSubmitter';

/**
 * POST /api/jobs/[id]/submit
 *
 * Manual retry endpoint for runs whose on-chain submitDeliverable failed
 * (e.g. Pinata 5xx, RPC flap, gas estimation). Re-pins the deliverable
 * (idempotent on Pinata side — same content → same CID) and re-sends the
 * tx from the service worker key.
 *
 * Body (optional): { runId?: string }   // defaults to most recent retryable run
 *
 * Returns:
 *   - 200 + submission proof on success
 *   - 404 if no retryable run found
 *   - 502 + error if retry also failed
 *   - 409 if run already submitted (no-op)
 *
 * Auth: deferred to B-future (Privy wallet sig). For testnet/grant demo
 * the route is open. The on-chain check (`msg.sender == job.worker`)
 * still prevents abuse — only our service worker can actually submit.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const jobId = params.id;
  const body = (await req.json().catch(() => ({}))) as { runId?: string };

  // 1. Find a candidate run for this job. Caller can target a specific
  //    runId; otherwise we pick the newest run that is in a retryable state.
  const runs = listRunsByJob(jobId);
  if (runs.length === 0) {
    return NextResponse.json(
      { error: 'no_runs_for_job', message: `No off-chain runs found for jobId ${jobId}.` },
      { status: 404 }
    );
  }

  const targetRunId = body.runId?.toLowerCase();
  let run = targetRunId
    ? runs.find((r) => r.id === targetRunId)
    : runs.find((r) => r.status === 'submit_failed' || r.status === 'completed');

  if (!run) {
    return NextResponse.json(
      {
        error: 'no_retryable_run',
        message: `No run in retryable state for jobId ${jobId}. Statuses: ${runs.map((r) => r.status).join(', ')}.`,
      },
      { status: 404 }
    );
  }

  if (run.status === 'submitted') {
    return NextResponse.json(
      {
        error: 'already_submitted',
        message: `Run ${run.id} already submitted on chain (tx ${run.submitTxHash}).`,
        submitTxHash: run.submitTxHash,
      },
      { status: 409 }
    );
  }

  if (run.output == null) {
    return NextResponse.json(
      {
        error: 'no_output',
        message: `Run ${run.id} has no output to submit (status=${run.status}).`,
      },
      { status: 422 }
    );
  }

  // 2. Mark `submitting`, attempt the on-chain submission.
  markSubmitting(run.id);
  try {
    const sub = await submitDeliverableForRun({
      jobId: BigInt(jobId),
      agentId: run.agentId,
      runId: run.id,
      input: run.input ?? '',
      output: run.output,
      // Stub metadata — re-running cannot recover original LLM trace, but
      // Pinata content addressability means same output → same CID anyway.
      // Anything we don't know we mark as 0/'retry' so it's auditable.
      model: 'retry',
      tokensUsed: 0,
      latencyMs: 0,
      startedAt: run.createdAt,
      completedAt: run.completedAt ?? Date.now(),
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
      retried: true,
      jobId: submitted.jobId,
      runId: submitted.id,
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
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markSubmitFailed(run.id, msg);
    return NextResponse.json(
      {
        ok: false,
        retried: true,
        jobId: run.jobId,
        runId: run.id,
        error: msg,
      },
      { status: 502 }
    );
  }
}
