import { NextResponse } from 'next/server';
import { createWalletClient, http, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  arcTestnet,
  buildGiveFeedbackConfig,
  publicClient,
} from '@arclayer/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type FeedbackBody = {
  agentTokenId?: string | number;
  score?: string | number;
  category?: string | number;
  comment?: string;
  metadataURI?: string;
  proofURI?: string;
  context?: string;
  ref?: `0x${string}`;
  jobId?: string;
  dryRun?: boolean;
};

function json(status: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status });
}

function isBytes32(value: unknown): value is `0x${string}` {
  return (
    typeof value === 'string' &&
    /^0x[0-9a-fA-F]{64}$/.test(value)
  );
}

function normalizePrivateKey(value: string | undefined): `0x${string}` | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed as `0x${string}`;
  }
  return null;
}

function parseBigIntField(
  value: unknown,
  name: string,
): bigint {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name}_required`);
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`${name}_must_be_integer`);
    return BigInt(value);
  }

  if (typeof value === 'string') {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new Error(`${name}_must_be_integer_string`);
    }
    return BigInt(value.trim());
  }

  throw new Error(`${name}_invalid`);
}

function parseCategory(value: unknown): number {
  const parsed = Number(value ?? 0);

  if (!Number.isInteger(parsed)) {
    throw new Error('category_must_be_integer');
  }

  if (parsed < 0 || parsed > 255) {
    throw new Error('category_out_of_uint8_range');
  }

  return parsed;
}

function normalizeRef(body: FeedbackBody): `0x${string}` {
  if (isBytes32(body.ref)) return body.ref;

  const seed = [
    'arclayer-feedback',
    String(body.agentTokenId ?? ''),
    String(body.score ?? ''),
    String(body.category ?? ''),
    body.jobId || '',
    body.context || '',
    body.comment || '',
    Date.now().toString(),
  ].join(':');

  return keccak256(toBytes(seed));
}

function requireAdmin(request: Request) {
  const expected = process.env.REPUTATION_FEEDBACK_API_KEY;

  if (!expected) {
    throw new Error('missing_REPUTATION_FEEDBACK_API_KEY');
  }

  const received =
    request.headers.get('x-arclayer-admin-key') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  if (received !== expected) {
    throw new Error('unauthorized');
  }
}

export async function POST(request: Request) {
  try {
    requireAdmin(request);

    const body = (await request.json()) as FeedbackBody;

    const agentTokenId = parseBigIntField(body.agentTokenId, 'agentTokenId');
    const score = parseBigIntField(body.score, 'score');
    const category = parseCategory(body.category);

    if (agentTokenId <= BigInt(0)) {
      return json(400, {
        ok: false,
        error: 'agentTokenId_must_be_positive',
      });
    }

    // Conservative manual-test bound. Contract int128 supports much wider,
    // but keep this route narrow until scoring policy is final.
    if (score < BigInt(-1000) || score > BigInt(1000)) {
      return json(400, {
        ok: false,
        error: 'score_out_of_manual_test_range',
        allowedRange: '-1000..1000',
      });
    }

    const comment = String(body.comment || 'Manual ArcLayer reputation feedback').slice(0, 500);
    const metadataURI = String(body.metadataURI || '');
    const proofURI = String(body.proofURI || 'arclayer://proof/manual-feedback');
    const context = String(body.context || 'manual-reputation-feedback').slice(0, 200);
    const ref = normalizeRef(body);

    const config = buildGiveFeedbackConfig(
      agentTokenId,
      score,
      category,
      comment,
      metadataURI,
      proofURI,
      context,
      ref,
    );

    if (body.dryRun) {
      return json(200, {
        ok: true,
        dryRun: true,
        source: 'erc8004_reputation_registry',
        contract: config.address,
        functionName: config.functionName,
        args: config.args.map((arg) =>
          typeof arg === 'bigint' ? arg.toString() : arg
        ),
        ref,
      });
    }

    const pk = normalizePrivateKey(
      process.env.REPUTATION_FEEDBACK_PRIVATE_KEY ||
      process.env.REPUTATION_ORACLE_PK,
    );

    if (!pk) {
      return json(503, {
        ok: false,
        error: 'missing_or_invalid_REPUTATION_FEEDBACK_PRIVATE_KEY',
      });
    }

    const account = privateKeyToAccount(pk);

    const walletClient = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(process.env.ARC_RPC_URL),
    });

    const txHash = await walletClient.writeContract(config);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
      timeout: 60_000,
    });

    return json(200, {
      ok: true,
      source: 'erc8004_reputation_registry',
      agentTokenId: agentTokenId.toString(),
      score: score.toString(),
      category,
      comment,
      metadataURI,
      proofURI,
      context,
      ref,
      txHash,
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
      reviewer: account.address,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return json(
      message === 'unauthorized' ? 401 : 500,
      {
        ok: false,
        error: message,
        source: 'erc8004_reputation_registry',
      },
    );
  }
}
