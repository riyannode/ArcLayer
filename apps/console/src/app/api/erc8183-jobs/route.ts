import { NextRequest, NextResponse } from 'next/server';
import { CONTRACTS } from '@arclayer/sdk';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { createLocalErc8183Job, listErc8183Jobs } from '@/lib/erc8183-jobs/store';
import type { TxInstruction } from '@/lib/erc8183-jobs/types';
import { escrowRail } from '@/lib/rails/responses';

/**
 * GET /api/erc8183-jobs — list ERC-8183 escrow jobs
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiKey(req, [API_KEY_SCOPES.ERC8183_CREATE, API_KEY_SCOPES.ERC8183_TX]);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(req.url);
    const jobs = await listErc8183Jobs({
      buyerAgentId: searchParams.get('buyerAgentId') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      limit: Math.min(Number(searchParams.get('limit')) || 50, 200),
    });

    return NextResponse.json({
      ok: true,
      ...escrowRail(),
      count: jobs.length,
      jobs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'list_failed', message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.ERC8183_CREATE);
    if (auth.error) return auth.error;
    const body = await req.json();

    // Validate required fields
    const required = [
      'buyerAgentId', 'clientAddress', 'providerAgentId',
      'providerAddress', 'expiredAtUnix', 'budgetAtomic', 'inputPayload',
    ] as const;
    for (const field of required) {
      if (!body[field]) {
        return NextResponse.json(
          { ok: false, error: 'missing_field', message: `Missing required field: ${field}` },
          { status: 400 },
        );
      }
    }

    // Create local job record
    const job = await createLocalErc8183Job({
      buyerAgentId: body.buyerAgentId,
      clientAddress: body.clientAddress,
      providerAgentId: body.providerAgentId,
      providerAddress: body.providerAddress,
      evaluatorAgentId: body.evaluatorAgentId,
      evaluatorAddress: body.evaluatorAddress,
      expiredAtUnix: body.expiredAtUnix,
      description: body.description ?? '',
      hookAddress: body.hookAddress ?? '0x0000000000000000000000000000000000000000',
      budgetAtomic: body.budgetAtomic,
      inputPayload: body.inputPayload,
    });

    // Return createJob tx instruction
    const tx: TxInstruction = {
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      functionName: 'createJob',
      args: [
        body.providerAddress,
        body.evaluatorAddress ?? '0x0000000000000000000000000000000000000000',
        body.expiredAtUnix,
        body.description ?? '',
        body.hookAddress ?? '0x0000000000000000000000000000000000000000',
      ],
    };

    return NextResponse.json({
      ok: true,
      ...escrowRail(),
      nextAction: 'createJob',
      localJobId: job.localJobId,
      tx,
      message: 'Local ERC-8183 job created. Submit createJob tx via wallet, then POST /api/erc8183-jobs/[localJobId]/created with the tx hash.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'create_failed', message },
      { status: 500 },
    );
  }
}
