import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { keccak256, toBytes } from 'viem';
import { CONTRACTS } from '@arclayer/sdk';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { getErc8183JobByLocalId, attachErc8183PreparedSubmit } from '@/lib/erc8183-jobs/store';
import { assertErc8183Participant } from '@/lib/erc8183-jobs/authz';
import { escrowRail } from '@/lib/rails/responses';
import type { TxInstruction } from '@/lib/erc8183-jobs/types';

/**
 * Recursive stable JSON stringify for deterministic payload hashing.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${entries.join(',')}}`;
}

function deliverableHashHex(input: string): `0x${string}` {
  return keccak256(toBytes(input));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ localJobId: string }> },
) {
    const { localJobId } = await params;
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.ERC8183_SUBMIT);
    if (auth.error) return auth.error;
    const job = await getErc8183JobByLocalId(localJobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'job_not_found', message: 'ERC-8183 job not found.' },
        { status: 404 },
      );
    }

    // Guard: only the assigned worker or provider can submit results
    const submitAuthError = assertErc8183Participant(job, auth, ['worker', 'provider']);
    if (submitAuthError) return submitAuthError;

    if (!job.erc8183JobId) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'create_job_pending', message: 'createJob tx must be confirmed first.' },
        { status: 400 },
      );
    }

    const body = await req.json();
    const resultPayload = body.resultPayload;
    if (!resultPayload) {
      return NextResponse.json(
        { ok: false, ...escrowRail(), error: 'missing_result', message: 'resultPayload is required.' },
        { status: 400 },
      );
    }

    // Compute deterministic deliverable hash
    const canonicalResult = stableStringify(resultPayload);
    const deliverableHash: `0x${string}` = deliverableHashHex(canonicalResult);
    const resultPayloadHash = createHash('sha256').update(Buffer.from(canonicalResult, 'utf8')).digest('hex');

    // Optional proof payload (e.g. reasoning trace, execution log)
    const proofPayload = body.proofPayload ?? null;
    let proofPayloadHash: string | null = null;
    if (proofPayload) {
      const canonicalProof = stableStringify(proofPayload);
      proofPayloadHash = createHash('sha256').update(Buffer.from(canonicalProof, 'utf8')).digest('hex');
    }

    // Persist all proof data to local mirror before returning tx instruction
    await attachErc8183PreparedSubmit({
      localJobId: localJobId,
      resultPayload,
      resultPayloadHash,
      proofPayload: proofPayload ?? {},
      proofPayloadHash: proofPayloadHash ?? '',
      deliverableHash,
    });

    const tx: TxInstruction = {
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      functionName: 'submit',
      args: [job.erc8183JobId, deliverableHash, '0x'],
    };

    return NextResponse.json({
      ok: true,
      ...escrowRail(),
      nextAction: 'submit',
      localJobId: localJobId,
      erc8183JobId: job.erc8183JobId,
      deliverableHash,
      resultPayloadHash,
      proofPayloadHash,
      tx,
      message: 'Sign and broadcast submit tx, then POST /api/erc8183-jobs/[localJobId]/tx with tx_hash=submit.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, ...escrowRail(), error: 'submit_failed', message },
      { status: 500 },
    );
  }
}
