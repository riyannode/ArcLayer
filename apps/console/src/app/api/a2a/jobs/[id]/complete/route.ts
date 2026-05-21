import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, fallback, getAddress, http, isHex, type Address, type Hex } from 'viem';
import { ARC_RPC_URLS, arcTestnet } from '@arclayer/sdk';
import { requireApiKey } from '@/lib/a2a/auth';
import { applyRateLimit } from '@/lib/rate-limit';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { ERC8183JobStatus, extractJobCompletedFromReceipt, getERC8183Job } from '@/lib/a2a/onchain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CompleteBody = Record<string, unknown>;

type A2AJobRow = {
  id: string;
  is_onchain?: boolean | null;
  onchain_job_id?: string | null;
  submit_tx?: string | null;
  settlement_status?: number | string | null;
  evaluator?: string | null;
  proof?: unknown;
};

function makeArcPublicClient() {
  const rpcUrls = process.env.ARC_RPC_URL ? [process.env.ARC_RPC_URL, ...ARC_RPC_URLS] : ARC_RPC_URLS;
  return createPublicClient({
    chain: arcTestnet,
    transport: fallback(rpcUrls.map((url) => http(url, { timeout: 10_000 }))),
  });
}

function jsonError(error: string, status = 400, details?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...(details ?? {}) }, { status });
}

function normalizeHex(value: string, field: string): Hex {
  const normalized = value.trim().toLowerCase();
  if (!isHex(normalized)) throw new Error(`${field}_invalid_hex`);
  return normalized as Hex;
}

function sameAddress(a: string, b: string): boolean {
  return getAddress(a as Address) === getAddress(b as Address);
}

function isSubmittedOrLater(job: A2AJobRow): boolean {
  const status = job.settlement_status == null ? null : Number(job.settlement_status);
  return Boolean(job.submit_tx) || (status !== null && Number.isFinite(status) && status >= ERC8183JobStatus.Submitted);
}

function mergeProof(existing: unknown, incoming: unknown): unknown {
  if (
    existing &&
    incoming &&
    typeof existing === 'object' &&
    typeof incoming === 'object' &&
    !Array.isArray(existing) &&
    !Array.isArray(incoming)
  ) {
    return { ...(existing as Record<string, unknown>), ...(incoming as Record<string, unknown>) };
  }
  return incoming;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireApiKey(req, 'jobs:submit');
  if (auth.error) return auth.error;

  const limited = applyRateLimit(req, 'a2a:jobs:complete', {
    max: 60,
    agentId: auth.key.agentId,
  });
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError('invalid_json', 400);

  const completeTxValue = (body as CompleteBody).complete_tx;
  if (completeTxValue === undefined || completeTxValue === null || String(completeTxValue).trim() === '') {
    return jsonError('missing_required_fields', 400, { fields: ['complete_tx'] });
  }

  let completeTx: Hex;
  try {
    completeTx = normalizeHex(String(completeTxValue), 'complete_tx');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'complete_tx_invalid_hex';
    return jsonError(message, 400);
  }

  const supabase = getSupabaseAdmin();
  const { data: job, error: fetchErr } = await supabase
    .from('a2a_jobs')
    .select('id,is_onchain,onchain_job_id,submit_tx,settlement_status,evaluator,proof')
    .eq('id', params.id)
    .maybeSingle();

  if (fetchErr || !job) return jsonError('job_not_found', 404);

  const row = job as A2AJobRow;
  if (!row.is_onchain) return jsonError('job_not_onchain', 400);
  if (!row.onchain_job_id) return jsonError('onchain_job_id_missing', 400);
  if (!isSubmittedOrLater(row)) return jsonError('job_not_submitted', 400);

  const client = makeArcPublicClient();
  let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
  try {
    receipt = await client.getTransactionReceipt({ hash: completeTx });
  } catch (error) {
    console.error('[complete] getTransactionReceipt error:', error);
    return jsonError('complete_tx_receipt_not_found', 400);
  }

  if (receipt.status !== 'success') return jsonError('complete_tx_failed', 400);

  let completedEvent: ReturnType<typeof extractJobCompletedFromReceipt>;
  try {
    completedEvent = extractJobCompletedFromReceipt(receipt);
  } catch (error) {
    console.error('[complete] JobCompleted event parse error:', error);
    return jsonError('job_completed_event_not_found', 400);
  }

  const onchainJobId = String(row.onchain_job_id);
  if (completedEvent.jobId.toString() !== onchainJobId) {
    return jsonError('job_completed_event_job_id_mismatch', 400, {
      expected: onchainJobId,
      actual: completedEvent.jobId.toString(),
    });
  }

  let tx: Awaited<ReturnType<typeof client.getTransaction>>;
  let onchainJob: Awaited<ReturnType<typeof getERC8183Job>>;
  try {
    [tx, onchainJob] = await Promise.all([
      client.getTransaction({ hash: completeTx }),
      getERC8183Job(client, onchainJobId),
    ]);
  } catch (error) {
    console.error('[complete] on-chain verification error:', error);
    return jsonError('onchain_job_verification_failed', 400);
  }

  if (!sameAddress(tx.from, onchainJob.evaluator)) {
    return jsonError('complete_tx_evaluator_mismatch', 403, {
      expected: onchainJob.evaluator,
      actual: getAddress(tx.from),
    });
  }

  if (row.evaluator && !sameAddress(row.evaluator, onchainJob.evaluator)) {
    return jsonError('db_evaluator_mismatch', 409, {
      expected: getAddress(row.evaluator as Address),
      actual: onchainJob.evaluator,
    });
  }

  if (onchainJob.status !== ERC8183JobStatus.Completed) {
    return jsonError('onchain_job_not_completed', 400, {
      expected: ERC8183JobStatus.Completed.toString(),
      actual: onchainJob.status.toString(),
    });
  }

  const input = body as CompleteBody;
  const updatePayload: Record<string, unknown> = {
    complete_tx: completeTx,
    settlement_status: ERC8183JobStatus.Completed,
    status: 'submitted',
  };

  if (input.evaluation !== undefined) updatePayload.evaluation = input.evaluation;
  if (input.proof !== undefined) updatePayload.proof = mergeProof(row.proof, input.proof);

  const { data, error } = await supabase.from('a2a_jobs').update(updatePayload).eq('id', params.id).select().single();
  if (error) {
    console.error('[complete] a2a_jobs update error:', error.message);
    return jsonError('db_error', 500);
  }

  return NextResponse.json({
    ok: true,
    job: data,
    receipt: {
      jobId: params.id,
      onchainJobId,
      completeTx,
      settlementStatus: ERC8183JobStatus.Completed.toString(),
    },
  });
}
