import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createPublicClient, fallback, getAddress, http, isHex, type Address, type Hex } from 'viem';
import { ARC_RPC_URLS, arcTestnet } from '@arclayer/sdk';
import { submitA2AJob } from '@/lib/a2a/jobs';
import { requireApiKey } from '@/lib/a2a/auth';
import { applyRateLimit } from '@/lib/rate-limit';
import { recordDelivery } from '@/lib/a2a/reputation';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { ERC8183JobStatus, extractJobSubmittedFromReceipt, getERC8183Job } from '@/lib/a2a/onchain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SubmitBody = Record<string, unknown>;

type A2AJobRow = {
  id: string;
  claimed_by?: string | null;
  is_onchain?: boolean | null;
  onchain_job_id?: string | null;
  provider?: string | null;
};

const REQUIRED_ONCHAIN_FIELDS = ['output', 'proof', 'deliverable_uri', 'deliverable_hash', 'proof_uri', 'submit_tx'] as const;

function makeArcPublicClient() {
  const rpcUrls = process.env.ARC_RPC_URL ? [process.env.ARC_RPC_URL, ...ARC_RPC_URLS] : ARC_RPC_URLS;
  return createPublicClient({
    chain: arcTestnet,
    transport: fallback(rpcUrls.map((url) => http(url, { timeout: 10_000 }))),
  });
}

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function jsonError(error: string, status = 400, details?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(details ?? {}) }, { status });
}

function missingRequiredOnchainFields(body: SubmitBody): string[] {
  return REQUIRED_ONCHAIN_FIELDS.filter((field) => {
    const value = body[field];
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  });
}

function normalizeHex(value: string, field: string): Hex {
  const normalized = value.trim().toLowerCase();
  if (!isHex(normalized)) throw new Error(`${field}_invalid_hex`);
  return normalized as Hex;
}

function sameAddress(a: string, b: string): boolean {
  return getAddress(a as Address) === getAddress(b as Address);
}

async function handleOnchainSubmit(params: { jobId: string; agentId: string; body: SubmitBody; job: A2AJobRow }) {
  const { jobId, agentId, body, job } = params;
  const missing = missingRequiredOnchainFields(body);
  if (missing.length > 0) return jsonError('missing_required_fields', 400, { fields: missing });

  const output = body.output;
  const proof = body.proof;
  const deliverableUri = String(body.deliverable_uri).trim();
  const deliverableHash = normalizeHex(String(body.deliverable_hash), 'deliverable_hash');
  const proofUri = String(body.proof_uri).trim();
  const submitTx = normalizeHex(String(body.submit_tx), 'submit_tx');
  const onchainJobId = String(job.onchain_job_id);

  if (job.claimed_by && job.claimed_by !== agentId) return jsonError('agent_did_not_claim_job', 403);

  const client = makeArcPublicClient();
  let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
  let tx: Awaited<ReturnType<typeof client.getTransaction>>;
  let onchainJob: Awaited<ReturnType<typeof getERC8183Job>>;
  let submittedEvent: ReturnType<typeof extractJobSubmittedFromReceipt>;

  try {
    receipt = await client.getTransactionReceipt({ hash: submitTx });
  } catch (error) {
    console.error('[submit] getTransactionReceipt error:', error);
    return jsonError('submit_tx_receipt_not_found', 400);
  }

  if (receipt.status !== 'success') return jsonError('submit_tx_failed', 400);

  try {
    submittedEvent = extractJobSubmittedFromReceipt(receipt);
  } catch (error) {
    console.error('[submit] JobSubmitted event parse error:', error);
    return jsonError('job_submitted_event_not_found', 400);
  }

  if (submittedEvent.jobId.toString() !== onchainJobId) {
    return jsonError('job_submitted_event_job_id_mismatch', 400, {
      expected: onchainJobId,
      actual: submittedEvent.jobId.toString(),
    });
  }

  if (submittedEvent.deliverable.toLowerCase() !== deliverableHash) {
    return jsonError('job_submitted_event_deliverable_mismatch', 400, {
      expected: deliverableHash,
      actual: submittedEvent.deliverable.toLowerCase(),
    });
  }

  try {
    [tx, onchainJob] = await Promise.all([
      client.getTransaction({ hash: submitTx }),
      getERC8183Job(client, onchainJobId),
    ]);
  } catch (error) {
    console.error('[submit] on-chain verification error:', error);
    return jsonError('onchain_job_verification_failed', 400);
  }

  if (!sameAddress(tx.from, onchainJob.provider)) {
    return jsonError('submit_tx_provider_mismatch', 403, {
      expected: onchainJob.provider,
      actual: getAddress(tx.from),
    });
  }

  if (job.provider && !sameAddress(job.provider, onchainJob.provider)) {
    return jsonError('db_provider_mismatch', 409, {
      expected: getAddress(job.provider as Address),
      actual: onchainJob.provider,
    });
  }

  if (onchainJob.status !== ERC8183JobStatus.Submitted) {
    return jsonError('onchain_job_not_submitted', 400, {
      expected: ERC8183JobStatus.Submitted.toString(),
      actual: onchainJob.status.toString(),
    });
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    status: 'submitted',
    output,
    proof,
    deliverable_uri: deliverableUri,
    deliverable_hash: deliverableHash,
    proof_uri: proofUri,
    submit_tx: submitTx,
    settlement_status: ERC8183JobStatus.Submitted,
    submitted_at: now,
  };

  if (!job.claimed_by) {
    updatePayload.agent_id = agentId;
    updatePayload.claimed_by = agentId;
    updatePayload.claimed_at = now;
  }

  const { data, error } = await supabase.from('a2a_jobs').update(updatePayload).eq('id', jobId).select().single();
  if (error) {
    console.error('[submit] a2a_jobs update error:', error.message);
    return jsonError('db_error', 500);
  }

  const receiptId = `receipt_${stableHash({ id: jobId, agentId, output, proof, submitTx })}`;
  const result = {
    ok: true,
    job: data,
    receipt: {
      id: receiptId,
      jobId,
      agentId,
      status: 'submitted',
      submittedAt: now,
      onchainJobId,
      submitTx,
      settlementStatus: ERC8183JobStatus.Submitted.toString(),
    },
  };

  recordDelivery({
    providerAgentId: agentId,
    buyerAgentId: 'arclayer-system',
    jobId,
    delivered: true,
  }).catch((e) => console.error('[submit] recordDelivery error:', e));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Phase 11: require API key with jobs:submit scope
  const auth = await requireApiKey(req, 'jobs:submit');
  if (auth.error) return auth.error;

  // Phase 12: 60 submits per minute per agent
  const limited = applyRateLimit(req, 'a2a:jobs:submit', {
    max: 60,
    agentId: auth.key.agentId,
  });
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { data: job, error: fetchErr } = await supabase
    .from('a2a_jobs')
    .select('id,claimed_by,is_onchain,onchain_job_id,provider')
    .eq('id', params.id)
    .maybeSingle();

  if (fetchErr || !job) return NextResponse.json({ ok: false, error: 'job_not_found' }, { status: 404 });

  if ((job as A2AJobRow).is_onchain && (job as A2AJobRow).onchain_job_id) {
    try {
      return await handleOnchainSubmit({ jobId: params.id, agentId: auth.key.agentId, body: body as SubmitBody, job: job as A2AJobRow });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'submit_failed';
      if (message.endsWith('_invalid_hex')) return jsonError(message, 400);
      console.error('[submit] on-chain submit error:', error);
      return jsonError('submit_failed', 500);
    }
  }

  const { output, proof, summary } = body as Record<string, unknown>;
  const result = await submitA2AJob(params.id, {
    agentId: auth.key.agentId,
    output,
    proof,
    summary: typeof summary === 'string' ? summary : undefined,
  });
  if (!result.ok) return NextResponse.json(result, { status: result.error === 'job_not_found' ? 404 : 403 });

  // Phase 13: fire-and-forget on-chain reputation recording
  recordDelivery({
    providerAgentId: auth.key.agentId,
    buyerAgentId: 'arclayer-system',
    jobId: params.id,
    delivered: true,
  }).catch((e) => console.error('[submit] recordDelivery error:', e));

  return NextResponse.json(result);
}
