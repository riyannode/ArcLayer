import { NextRequest, NextResponse } from 'next/server';
import { keccak256, toBytes } from 'viem';
import { CONTRACTS } from '@arclayer/sdk';
import { getErc8183JobByLocalId } from '@/lib/erc8183-jobs/store';
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
  { params }: { params: { localJobId: string } },
) {
  try {
    const job = await getErc8183JobByLocalId(params.localJobId);
    if (!job) {
      return NextResponse.json(
        { ok: false, error: 'job_not_found', message: 'ERC-8183 job not found.' },
        { status: 404 },
      );
    }

    if (!job.erc8183JobId) {
      return NextResponse.json(
        { ok: false, error: 'create_job_pending', message: 'createJob tx must be confirmed first.' },
        { status: 400 },
      );
    }

    const body = await req.json();
    const resultPayload = body.resultPayload;
    if (!resultPayload) {
      return NextResponse.json(
        { ok: false, error: 'missing_result', message: 'resultPayload is required.' },
        { status: 400 },
      );
    }

    // Compute deterministic deliverable hash
    const canonicalResult = stableStringify(resultPayload);
    const deliverableHash: `0x${string}` = deliverableHashHex(canonicalResult);
    const resultPayloadHash = createHash('sha256').update(Buffer.from(canonicalResult, 'utf8')).digest('hex');

    const tx: TxInstruction = {
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      functionName: 'submit',
      args: [job.erc8183JobId, deliverableHash, '0x'],
    };

    return NextResponse.json({
      ok: true,
      settlementMode: 'erc8183_escrow',
      nextAction: 'submit',
      localJobId: params.localJobId,
      erc8183JobId: job.erc8183JobId,
      deliverableHash,
      resultPayloadHash,
      tx,
      message: 'Sign and broadcast submit tx, then POST /api/erc8183-jobs/[localJobId]/tx with tx_hash=submit.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'submit_failed', message },
      { status: 500 },
    );
  }
}
