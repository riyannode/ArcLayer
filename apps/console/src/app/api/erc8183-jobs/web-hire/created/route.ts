/**
 * POST /api/erc8183-jobs/web-hire/created
 *
 * Phase 2 of the direct-hire flow: confirms a createJob transaction
 * by reading the receipt from Arc Testnet, verifying the JobCreated
 * event, creating/updating the local ERC-8183 job record, and
 * marking the preparation as created.
 *
 * Auth: accepts EITHER:
 *   1. API key (Authorization: Bearer ***) with erc8183:create scope
 *   2. Wallet session cookie (arclayer-wallet-session)
 *
 * For wallet session auth:
 *   - preparation's buyer agent must belong to session linked agents
 *
 * Never signs transactions. Never reads private keys.
 * Never mutates x402 state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey, API_KEY_SCOPES } from '@/lib/a2a/auth';
import {
  readTransactionReceipt,
  decodeJobCreatedFromReceipt,
} from '@/lib/erc8183-jobs/receipt';
import {
  createLocalErc8183Job,
  attachErc8183CreateTx,
} from '@/lib/erc8183-jobs/store';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import {
  resolveSessionFromCookie,
  getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME,
  type WalletSession,
  type LinkedAgent,
} from '@/lib/auth/wallet-session';
import type { Hex, Address } from 'viem';

export const dynamic = 'force-dynamic';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

// ── Auth types ────────────────────────────────────────────────────────────

interface ApiKeyAuth {
  type: 'api_key';
  agentId: string;
}

interface WalletSessionAuth {
  type: 'wallet_session';
  session: WalletSession;
  linkedAgents: LinkedAgent[];
}

type AuthResult = ApiKeyAuth | WalletSessionAuth;

// ── Auth resolution ───────────────────────────────────────────────────────

async function attemptAuth(
  req: NextRequest,
): Promise<{ auth: AuthResult; error?: never } | { auth?: never; error: NextResponse }> {
  // 1. Try API key
  const apiKeyResult = await requireApiKey(req, [API_KEY_SCOPES.ERC8183_CREATE]);
  if (!apiKeyResult.error) {
    return { auth: { type: 'api_key', agentId: apiKeyResult.key.agentId } };
  }

  // 2. Try wallet session cookie
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'unauthorized', detail: 'API key or wallet session required' },
        { status: 401, headers: { 'Cache-Control': ERROR_CACHE } },
      ),
    };
  }

  const session = await resolveSessionFromCookie(cookieValue);
  if (!session) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'invalid_session', detail: 'Wallet session is invalid or expired' },
        { status: 401, headers: { 'Cache-Control': ERROR_CACHE } },
      ),
    };
  }

  const linkedAgents = await getLinkedErc8004AgentsForController(session.wallet);
  return { auth: { type: 'wallet_session', session, linkedAgents } };
}

function validateBuyerOwnership(
  buyerAgentId: string,
  linkedAgents: LinkedAgent[],
): boolean {
  return linkedAgents.some(
    (agent) => agent.tokenId === buyerAgentId || agent.agentId === buyerAgentId,
  );
}

// ── Preparation row type ──────────────────────────────────────────────────

interface PreparationRow {
  id: string;
  buyer_agent_id: string;
  provider_agent_id: string;
  evaluator_agent_id: string | null;
  evaluator_mode: string;
  buyer_controller: string;
  provider_controller: string;
  evaluator_controller: string;
  budget_atomic: string;
  expired_at_unix: string;
  description: string;
  hook: string;
  input_payload_hash: string;
  prepared_by_wallet: string | null;
  status: string;
  create_tx_hash: string | null;
  erc8183_job_id: string | null;
  created_at: string;
  expires_at: string;
}

// ── Route handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Dual auth
    const authResult = await attemptAuth(req);
    if (authResult.error) return authResult.error;

    const auth = authResult.auth;
    const body = await req.json();

    // Guard: body must be a non-null object
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: 'invalid_body', detail: 'Request body must be a JSON object' },
        { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // Validate prepareId
    const prepareId = body.prepareId as string | undefined;
    if (!prepareId || typeof prepareId !== 'string') {
      return NextResponse.json(
        { ok: false, error: 'missing_prepareId', detail: 'prepareId is required' },
        { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // Validate createTxHash
    const createTxHash = body.createTxHash as string | undefined;
    if (!createTxHash || typeof createTxHash !== 'string' || !TX_HASH_RE.test(createTxHash)) {
      return NextResponse.json(
        { ok: false, error: 'invalid_tx_hash', detail: 'createTxHash must match /^0x[a-fA-F0-9]{64}$/' },
        { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // ── Atomic claim: prepared → creating ──────────────────────────────
    const supabase = getSupabaseAdmin();
    const { data: claimedRows, error: claimError } = await supabase
      .from('erc8183_hire_preparations')
      .update({ status: 'creating' })
      .eq('id', prepareId)
      .eq('status', 'prepared')
      .select('*');

    if (claimError) {
      console.error('[created] failed to claim preparation:', claimError.message);
      return NextResponse.json(
        { ok: false, error: 'preparation_claim_failed', detail: claimError.message },
        { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    if (!claimedRows || claimedRows.length === 0) {
      // Either not found, expired, or already claimed — load to give better detail
      const { data: existing } = await supabase
        .from('erc8183_hire_preparations')
        .select('status, erc8183_job_id, create_tx_hash')
        .eq('id', prepareId)
        .maybeSingle();

      if (!existing) {
        return NextResponse.json(
          { ok: false, error: 'preparation_not_found', detail: `No preparation found for prepareId "${prepareId}"` },
          { status: 404, headers: { 'Cache-Control': ERROR_CACHE } },
        );
      }

      return NextResponse.json(
        {
          ok: false,
          error: 'already_created_or_in_progress',
          detail: `Preparation status is "${existing.status}", expected "prepared"`,
          ...(existing.erc8183_job_id ? { erc8183JobId: existing.erc8183_job_id } : {}),
          ...(existing.create_tx_hash ? { createTxHash: existing.create_tx_hash } : {}),
        },
        { status: 409, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    const prep = claimedRows[0] as PreparationRow;

    // Reject if expired (check after claim to avoid TOCTOU)
    if (new Date(prep.expires_at).getTime() < Date.now()) {
      // Rollback: mark as expired
      await supabase
        .from('erc8183_hire_preparations')
        .update({ status: 'expired' })
        .eq('id', prepareId)
        .eq('status', 'creating');

      return NextResponse.json(
        { ok: false, error: 'preparation_expired', detail: 'This preparation has expired. Please prepare again.' },
        { status: 410, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // If wallet session auth, enforce buyer ownership
    if (auth.type === 'wallet_session') {
      if (!validateBuyerOwnership(prep.buyer_agent_id, auth.linkedAgents)) {
        // Rollback: mark as failed
        await supabase
          .from('erc8183_hire_preparations')
          .update({ status: 'failed' })
          .eq('id', prepareId)
          .eq('status', 'creating');

        return NextResponse.json(
          {
            ok: false,
            error: 'buyer_not_linked',
            detail: `Preparation buyer agent "${prep.buyer_agent_id}" is not linked to session wallet ${auth.session.wallet}`,
          },
          { status: 403, headers: { 'Cache-Control': ERROR_CACHE } },
        );
      }
    }

    // ── Read transaction receipt from Arc Testnet ──────────────────────
    const receipt = await readTransactionReceipt(createTxHash as Hex);
    if (!receipt) {
      // Don't rollback — tx may arrive later. Keep status='creating' so retry works.
      return NextResponse.json(
        { ok: false, error: 'tx_not_found', detail: 'Transaction not found. It may not have been mined yet. Retry after a few seconds.' },
        { status: 202, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // Confirm tx succeeded
    if (receipt.status !== 'success') {
      await supabase
        .from('erc8183_hire_preparations')
        .update({ status: 'failed' })
        .eq('id', prepareId)
        .eq('status', 'creating');

      return NextResponse.json(
        { ok: false, error: 'tx_reverted', detail: 'createJob transaction reverted on-chain.' },
        { status: 422, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // ── Verify tx sender = buyer controller ────────────────────────────
    const txSender = receipt.from.toLowerCase() as string;
    const expectedBuyer = prep.buyer_controller.toLowerCase();
    if (txSender !== expectedBuyer) {
      await supabase
        .from('erc8183_hire_preparations')
        .update({ status: 'failed' })
        .eq('id', prepareId)
        .eq('status', 'creating');

      return NextResponse.json(
        {
          ok: false,
          error: 'tx_sender_mismatch',
          detail: `Transaction sender ${txSender} does not match preparation buyer controller ${expectedBuyer}`,
        },
        { status: 422, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // Decode JobCreated event
    const decodedEvent = decodeJobCreatedFromReceipt(receipt);
    if (!decodedEvent) {
      await supabase
        .from('erc8183_hire_preparations')
        .update({ status: 'failed' })
        .eq('id', prepareId)
        .eq('status', 'creating');

      return NextResponse.json(
        { ok: false, error: 'job_created_event_not_found', detail: 'Could not decode JobCreated event from receipt logs.' },
        { status: 422, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    const erc8183JobId = decodedEvent.jobId.toString();

    // Verify event values match preparation
    const decodedProvider = decodedEvent.provider.toLowerCase();
    const expectedProvider = prep.provider_controller.toLowerCase();
    if (decodedProvider !== expectedProvider) {
      await supabase
        .from('erc8183_hire_preparations')
        .update({ status: 'failed' })
        .eq('id', prepareId)
        .eq('status', 'creating');

      return NextResponse.json(
        {
          ok: false,
          error: 'event_provider_mismatch',
          detail: `Decoded JobCreated.provider ${decodedProvider} does not match preparation provider ${expectedProvider}`,
        },
        { status: 422, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    const decodedEvaluator = decodedEvent.evaluator.toLowerCase();
    const expectedEvaluator = prep.evaluator_controller.toLowerCase();
    if (decodedEvaluator !== expectedEvaluator) {
      await supabase
        .from('erc8183_hire_preparations')
        .update({ status: 'failed' })
        .eq('id', prepareId)
        .eq('status', 'creating');

      return NextResponse.json(
        {
          ok: false,
          error: 'event_evaluator_mismatch',
          detail: `Decoded JobCreated.evaluator ${decodedEvaluator} does not match preparation evaluator ${expectedEvaluator}`,
        },
        { status: 422, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // ── Create local ERC-8183 job record ───────────────────────────────
    const job = await createLocalErc8183Job({
      buyerAgentId: prep.buyer_agent_id,
      clientAddress: prep.buyer_controller,
      providerAgentId: prep.provider_agent_id,
      providerAddress: prep.provider_controller,
      evaluatorAgentId: prep.evaluator_agent_id ?? undefined,
      evaluatorAddress: prep.evaluator_controller,
      expiredAtUnix: prep.expired_at_unix,
      description: prep.description,
      hookAddress: prep.hook,
      budgetAtomic: prep.budget_atomic,
      inputPayload: { source: 'direct-hire', prepareId },
    });

    // Attach create tx hash and erc8183 job id
    await attachErc8183CreateTx({
      localJobId: job.localJobId,
      createTxHash,
      erc8183JobId,
    });

    // ── Mark preparation as created ────────────────────────────────────
    await supabase
      .from('erc8183_hire_preparations')
      .update({
        status: 'created',
        create_tx_hash: createTxHash,
        erc8183_job_id: erc8183JobId,
      })
      .eq('id', prepareId)
      .eq('status', 'creating');

    return NextResponse.json(
      {
        ok: true,
        localJobId: job.localJobId,
        erc8183JobId,
        createTxHash,
        status: 'created',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json(
      { ok: false, error: 'created_failed', detail: message },
      { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }
}
