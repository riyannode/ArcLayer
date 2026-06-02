/**
 * POST /api/erc8183-jobs/web-hire/prepare
 *
 * Validates and normalizes web hire/import input for ERC-8183 escrow jobs.
 * Resolves agentId → controller from erc8004_agents DB (never trusts body).
 * Returns safe next-step instructions for the existing ERC-8183 flow.
 *
 * Auth: accepts EITHER:
 *   1. API key (Authorization: Bearer ak_...) with erc8183:create scope
 *   2. Wallet session cookie (arclayer-wallet-session) from PR #408
 *
 * For wallet session auth:
 *   - buyerAgentId must be linked to the session wallet
 *   - Returns 401 if no auth at all
 *   - Returns 403 if wallet session exists but buyerAgentId not linked
 *
 * Never signs transactions. Never reads private keys.
 * Never mutates x402 state. API contract + validation only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey, API_KEY_SCOPES } from '@/lib/a2a/auth';
import {
  validateWebHireInput,
  resolveIdentityAndBuild,
  createSupabaseIdentityResolver,
} from '@/lib/erc8183-jobs/web-hire-contract';
import { escrowRail } from '@/lib/rails/responses';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import {
  resolveSessionFromCookie,
  getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME,
  type WalletSession,
  type LinkedAgent,
} from '@/lib/auth/wallet-session';

export const dynamic = 'force-dynamic';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';

// Map identity errors to HTTP status codes
const IDENTITY_ERRORS = new Set([
  'buyer_identity_not_found',
  'provider_identity_not_found',
  'evaluator_identity_not_found',
  'buyer_controller_mismatch',
  'provider_controller_mismatch',
  'evaluator_controller_mismatch',
]);

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

/**
 * Try API key first, then wallet session cookie.
 * Returns the auth result or a NextResponse error.
 */
async function attemptAuth(
  req: NextRequest,
): Promise<{ auth: AuthResult; error?: never } | { auth?: never; error: NextResponse }> {
  // 1. Try API key (existing path)
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

  // Load linked agents for the session wallet
  // Don't early-return on empty — let the route handler read the body first
  // and return buyer_not_linked with the actual buyerAgentId in the detail.
  const linkedAgents = await getLinkedErc8004AgentsForController(session.wallet);

  return { auth: { type: 'wallet_session', session, linkedAgents } };
}

/**
 * Validate that buyerAgentId is owned/controlled by the session wallet.
 * Checks both tokenId and agentId fields of linked agents.
 */
function validateBuyerOwnership(
  buyerAgentId: string,
  linkedAgents: LinkedAgent[],
): boolean {
  return linkedAgents.some(
    (agent) => agent.tokenId === buyerAgentId || agent.agentId === buyerAgentId,
  );
}

// ── Route handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Dual auth: API key or wallet session
    const authResult = await attemptAuth(req);
    if (authResult.error) return authResult.error;

    const auth = authResult.auth;
    const body = await req.json();

    // Guard: body must be a non-null object (not null, not array, not primitive)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: 'invalid_body', detail: 'Request body must be a JSON object' },
        { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // If wallet session auth, enforce buyerAgentId ownership
    if (auth.type === 'wallet_session') {
      const buyerAgentId = body.buyerAgentId as string | undefined;
      if (!buyerAgentId || typeof buyerAgentId !== 'string') {
        return NextResponse.json(
          { ok: false, error: 'missing_buyerAgentId', detail: 'buyerAgentId is required' },
          { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
        );
      }

      if (!validateBuyerOwnership(buyerAgentId, auth.linkedAgents)) {
        return NextResponse.json(
          {
            ok: false,
            error: 'buyer_not_linked',
            detail: `buyerAgentId "${buyerAgentId}" is not linked to session wallet ${auth.session.wallet}`,
          },
          { status: 403, headers: { 'Cache-Control': ERROR_CACHE } },
        );
      }
    }

    // Phase 1: Pure field validation (no DB)
    const validated = validateWebHireInput(body);

    if (!validated.ok) {
      const status =
        validated.error === 'invalid_settlementMode' ? 400 :
        validated.error.startsWith('missing_') ? 400 :
        validated.error.startsWith('invalid_') ? 400 :
        validated.error === 'expired_expiredAtUnix' ? 400 :
        validated.error === 'description_too_long' ? 400 :
        400;

      return NextResponse.json(
        { ok: false, ...escrowRail(), error: validated.error, detail: validated.detail },
        { status, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // Phase 2: Resolve agentId → controller from erc8004_agents DB
    const supabase = getSupabaseAdmin();
    const resolve = createSupabaseIdentityResolver(supabase);
    const result = await resolveIdentityAndBuild(validated, resolve);

    if (!result.ok) {
      const status = IDENTITY_ERRORS.has(result.error) ? 422 : 400;

      return NextResponse.json(
        { ok: false, ...escrowRail(), error: result.error, detail: result.detail },
        { status, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    // Phase 3: Persist preparation record
    const PREPARATION_TTL_MS = 30 * 60 * 1000; // 30 minutes
    const expiresAt = new Date(Date.now() + PREPARATION_TTL_MS).toISOString();
    const preparedByWallet =
      auth.type === 'wallet_session' ? auth.session.wallet : null;

    const { data: prepRow, error: prepError } = await supabase
      .from('erc8183_hire_preparations')
      .insert({
        buyer_agent_id: result.participants.client.agentId,
        provider_agent_id: result.participants.provider.agentId,
        evaluator_agent_id: result.participants.evaluator.agentId,
        evaluator_mode: result.participants.evaluator.mode,
        buyer_controller: result.participants.client.controller,
        provider_controller: result.participants.provider.controller,
        evaluator_controller: result.participants.evaluator.controller,
        budget_atomic: result.budget.atomic,
        expired_at_unix: result.expiry.expiredAtUnix,
        description: result.description,
        hook: result.next.createJob.hook,
        input_payload_hash: result.inputPayloadHash,
        prepared_by_wallet: preparedByWallet,
        status: 'prepared',
        expires_at: expiresAt,
      })
      .select('id')
      .single();

    if (prepError) {
      console.error('[prepare] failed to persist preparation:', prepError.message);
      // Non-fatal: still return the result even if persistence fails
    }

    const prepareId = prepRow?.id ?? null;

    return NextResponse.json(
      { ...result, prepareId },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json(
      { ok: false, error: 'prepare_failed', detail: message },
      { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }
}
