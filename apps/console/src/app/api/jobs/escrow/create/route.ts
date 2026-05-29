import { NextRequest, NextResponse } from 'next/server';
import { CONTRACTS } from '@arclayer/sdk';
import { createLocalErc8183Job } from '@/lib/erc8183-jobs/store';
import type { TxInstruction } from '@/lib/erc8183-jobs/types';
import { escrowRail } from '@/lib/rails/responses';

/**
 * POST /api/jobs/escrow/create
 *
 * Server-side wrapper for the escrow work order form.
 * Creates a local ERC-8183 job record and returns the on-chain createJob
 * tx instruction for the client to sign via wallet.
 *
 * No API key required — this is a console UI route.
 * The actual ERC-8183 creation flow uses the same store functions as
 * POST /api/erc8183-jobs but without requiring an external API key.
 */
export async function POST(req: NextRequest) {
  try {
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
      message: 'Local ERC-8183 job created. Sign the createJob tx via wallet, then POST /api/erc8183-jobs/[localJobId]/created with the tx hash.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'create_failed', message },
      { status: 500 },
    );
  }
}
