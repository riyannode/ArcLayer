import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { runAiResolver } from '@/lib/vault/ai-resolver';
import { withWalletAuth } from '@/lib/auth/wallet-auth';

type Action = 'submit' | 'approve' | 'reject' | 'dispute';

export const POST = withWalletAuth<{ jobId: string; mid: string }>(async (
  req: NextRequest,
  { params, wallet }
) => {
  const { jobId, mid } = await (params as unknown as Promise<{ jobId: string; mid: string }>);
  const body = await req.json() as {
    action: Action;
    deliverableUri?: string;
    feedbackUri?: string;
    reasonUri?: string;
    txHash?: string;
  };

  const supabase = getSupabaseAdmin();

  // Fetch job + milestone
  const { data: job, error: jobErr } = await supabase
    .from('vault_jobs')
    .select('*')
    .eq('id', jobId)
    .single();
  if (jobErr || !job) return NextResponse.json({ error: 'job not found' }, { status: 404 });

  const { data: ms, error: msErr } = await supabase
    .from('vault_milestones')
    .select('*')
    .eq('job_id', jobId)
    .eq('milestone_index', Number(mid))
    .single();
  if (msErr || !ms) return NextResponse.json({ error: 'milestone not found' }, { status: 404 });

  const isClient = wallet === job.client_address.toLowerCase();
  const isJobber = job.jobber_address && wallet === job.jobber_address.toLowerCase();

  switch (body.action) {
    case 'submit': {
      if (!isJobber) return NextResponse.json({ error: 'not jobber' }, { status: 403 });
      if (!['created', 'rejected'].includes(ms.status)) {
        return NextResponse.json({ error: `bad status: ${ms.status}` }, { status: 400 });
      }
      const now = new Date();
      const approveDeadline = new Date(now.getTime() + 48 * 3600 * 1000);
      const { error } = await supabase.from('vault_milestones').update({
        status: 'submitted',
        submitted_at: now.toISOString(),
        approve_deadline: approveDeadline.toISOString(),
        deliverable_uri: body.deliverableUri,
      }).eq('id', ms.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, status: 'submitted', approveDeadline });
    }

    case 'approve': {
      if (!isClient) return NextResponse.json({ error: 'not client' }, { status: 403 });
      if (ms.status !== 'submitted') {
        return NextResponse.json({ error: `bad status: ${ms.status}` }, { status: 400 });
      }
      const { error } = await supabase.from('vault_milestones').update({
        status: 'released',
        released_at: new Date().toISOString(),
        tx_hash_release: body.txHash,
      }).eq('id', ms.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      await supabase.from('vault_jobs').update({
        released_to_jobber: Number(job.released_to_jobber) + Number(ms.amount),
      }).eq('id', job.id);

      return NextResponse.json({ ok: true, status: 'released' });
    }

    case 'reject': {
      if (!isClient) return NextResponse.json({ error: 'not client' }, { status: 403 });
      if (ms.status !== 'submitted') {
        return NextResponse.json({ error: `bad status: ${ms.status}` }, { status: 400 });
      }

      // 3rd rejection → auto-escalate to AI resolver
      if (ms.revisions >= 2) {
        return await escalateToResolver(supabase, job, ms, wallet, body.feedbackUri);
      }

      const { error } = await supabase.from('vault_milestones').update({
        status: 'rejected',
        revisions: ms.revisions + 1,
        feedback_uri: body.feedbackUri,
      }).eq('id', ms.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, status: 'rejected', revisions: ms.revisions + 1 });
    }

    case 'dispute': {
      if (!isClient && !isJobber) return NextResponse.json({ error: 'not party' }, { status: 403 });
      if (ms.status !== 'submitted') {
        return NextResponse.json({ error: `bad status: ${ms.status}` }, { status: 400 });
      }
      return await escalateToResolver(supabase, job, ms, wallet, body.reasonUri);
    }
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
});

async function escalateToResolver(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  job: { id: string; spec_json: unknown },
  ms: { id: string; deliverable_uri: string | null; feedback_uri: string | null; revisions: number },
  initiator: string,
  reasonUri?: string
) {
  // Mark milestone disputed
  await supabase.from('vault_milestones').update({ status: 'disputed' }).eq('id', ms.id);
  await supabase.from('vault_jobs').update({ status: 'disputed' }).eq('id', job.id);

  // Run AI resolver Tier 0
  let aiOut, autoFinal = false;
  try {
    const result = await runAiResolver({
      jobId: job.id,
      milestoneId: ms.id,
      specJson: job.spec_json,
      deliverableUri: ms.deliverable_uri,
      feedbackUri: ms.feedback_uri,
      revisionCount: ms.revisions,
    });
    aiOut = result.output;
    autoFinal = result.autoFinal;
  } catch (err) {
    aiOut = { decision: 'escalate', confidence: 0, reason: `AI failed: ${(err as Error).message}`, matchedCriteria: [], missingEvidence: [] };
  }

  // Insert dispute record
  const tier = autoFinal ? 'ai' : 'human';
  const { data: dispute } = await supabase.from('vault_disputes').insert({
    job_id: job.id,
    milestone_id: ms.id,
    initiator_address: initiator,
    tier,
    outcome: autoFinal && aiOut.decision !== 'escalate' ? aiOut.decision : null,
    jobber_bps: aiOut.recommendedSplit?.jobberBps,
    client_bps: aiOut.recommendedSplit?.clientBps,
    reason_uri: reasonUri,
    ai_analysis: aiOut,
    ai_confidence: aiOut.confidence,
    resolved_by: autoFinal ? 'ai' : null,
    resolved_at: autoFinal ? new Date().toISOString() : null,
  }).select().single();

  // Audit log
  await supabase.from('resolver_decisions').insert({
    dispute_id: dispute?.id,
    tier,
    resolver_address: autoFinal ? 'ai' : null,
    decision: aiOut.decision === 'escalate' ? 'refund' : aiOut.decision, // placeholder for non-final
    jobber_bps: aiOut.recommendedSplit?.jobberBps,
    client_bps: aiOut.recommendedSplit?.clientBps,
    reasoning: aiOut.reason,
    evidence_reviewed: { matched: aiOut.matchedCriteria, missing: aiOut.missingEvidence },
    confidence: aiOut.confidence,
  });

  return NextResponse.json({
    ok: true,
    status: 'disputed',
    autoFinal,
    aiDecision: aiOut,
    dispute,
  });
}
