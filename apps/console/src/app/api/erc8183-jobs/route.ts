import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { CONTRACTS } from '@arclayer/sdk';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { createLocalErc8183Job, listErc8183Jobs } from '@/lib/erc8183-jobs/store';
import { isErc8183Admin } from '@/lib/erc8183-jobs/authz';
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

    return humanJson(req, {
      ok: true,
      ...escrowRail(),
      count: jobs.length,
      jobs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return humanJson(req, { ok: false, error: 'list_failed', message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.ERC8183_CREATE);
    if (auth.error) return auth.error;
    const body = await req.json();

    // Guard: buyerAgentId must match the authenticated key — prevents
    // impersonation even with a valid erc8183:create-scoped API key
    if (isErc8183Admin(auth.key.scopes) === false && body.buyerAgentId !== auth.key.agentId) {
      return humanJson(req, {
          ok: false,
          ...escrowRail(),
          error: 'participant_mismatch',
          expectedRole: 'buyer',
          expectedAgentId: body.buyerAgentId,
          authenticatedAgentId: auth.key.agentId,
          hint: 'buyerAgentId must match the authenticated API key agentId (or use an admin/erc8183:admin-scoped key).',
        }, { status: 403 });
    }

    // Validate required fields
    const required = [
      'buyerAgentId', 'clientAddress', 'providerAgentId',
      'providerAddress', 'evaluatorAddress', 'expiredAtUnix', 'budgetAtomic', 'inputPayload',
    ] as const;
    for (const field of required) {
      if (!body[field]) {
        return humanJson(req, { ok: false, error: 'missing_field', message: `Missing required field: ${field}` }, { status: 400 });
      }
    }

    // ERC-8183: evaluator MUST be non-zero (reverts on zero address)
    const ZERO = '0x0000000000000000000000000000000000000000';
    if (String(body.evaluatorAddress).toLowerCase() === ZERO) {
      return humanJson(req, { ok: false, error: 'invalid_evaluator', message: 'evaluatorAddress cannot be zero. Use client wallet as evaluator for self-evaluation.' }, { status: 400 });
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
        body.evaluatorAddress,
        body.expiredAtUnix,
        body.description ?? '',
        body.hookAddress ?? '0x0000000000000000000000000000000000000000',
      ],
    };

    return humanJson(req, {
      ok: true,
      ...escrowRail(),
      nextAction: 'createJob',
      localJobId: job.localJobId,
      tx,
      message: 'Local ERC-8183 job created. Submit createJob tx via wallet, then POST /api/erc8183-jobs/[localJobId]/created with the tx hash.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return humanJson(req, { ok: false, error: 'create_failed', message }, { status: 500 });
  }
}
