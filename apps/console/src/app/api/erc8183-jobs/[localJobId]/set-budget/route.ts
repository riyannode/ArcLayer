import { humanJson } from '@/lib/api/human-json';
import { NextRequest } from 'next/server';
import { CONTRACTS } from '@arclayer/sdk';
import { API_KEY_SCOPES, requireApiKey } from '@/lib/a2a/auth';
import { getErc8183JobByLocalId } from '@/lib/erc8183-jobs/store';
import { assertErc8183Participant } from '@/lib/erc8183-jobs/authz';
import { escrowRail } from '@/lib/rails/responses';
import type { TxInstruction } from '@/lib/erc8183-jobs/types';
import { getAgentWalletPaymentHint } from '@/lib/agent-accounts/payment-hint';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ localJobId: string }> },
) {
    const { localJobId } = await params;
  try {
    const auth = await requireApiKey(req, API_KEY_SCOPES.ERC8183_TX);
    if (auth.error) return auth.error;
    const job = await getErc8183JobByLocalId(localJobId);
    if (!job) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'job_not_found', message: 'ERC-8183 job not found.' }, { status: 404 });
    }

    // Guard: only the provider can set the budget on-chain
    const budgetAuthError = assertErc8183Participant(job, auth, ['provider']);
    if (budgetAuthError) return budgetAuthError;

    // Guard: erc8183_job_id must exist (createJob tx confirmed)
    if (!job.erc8183JobId) {
      return humanJson(req, { ok: false, ...escrowRail(), error: 'create_job_pending', message: 'createJob tx must be confirmed first. POST /api/erc8183-jobs/[localJobId]/created.' }, { status: 400 });
    }

    const tx: TxInstruction = {
      address: CONTRACTS.ERC8183_AGENTIC_COMMERCE,
      functionName: 'setBudget',
      args: [job.erc8183JobId, job.priceAtomic, '0x'],
    };

    const paymentHint = await getAgentWalletPaymentHint(auth.key.createdBy);

    return humanJson(req, {
      ok: true,
      ...escrowRail(),
      nextAction: 'setBudget',
      localJobId: localJobId,
      erc8183JobId: job.erc8183JobId,
      payerRail: paymentHint.payerRail,
      payerAddress: paymentHint.payerAddress,
      legacyEoaFallback: paymentHint.legacyEoaFallback,
      tx,
      message:
        paymentHint.payerRail === 'circle-agent-wallet'
          ? 'Use the Circle Agent Wallet rail to set the budget. After confirmed, POST /api/erc8183-jobs/[localJobId]/tx with tx_hash=set_budget.'
          : 'Legacy fallback: sign and broadcast setBudget tx, then POST /api/erc8183-jobs/[localJobId]/tx with tx_hash=set_budget.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return humanJson(req, { ok: false, ...escrowRail(), error: 'set_budget_failed', message }, { status: 500 });
  }
}
