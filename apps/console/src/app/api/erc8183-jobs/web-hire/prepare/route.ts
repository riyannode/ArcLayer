/**
 * POST /api/erc8183-jobs/web-hire/prepare
 *
 * Validates and normalizes web hire/import input for ERC-8183 escrow jobs.
 * Resolves agentId → controller from erc8004_agents DB (never trusts body).
 * Returns safe next-step instructions for the existing ERC-8183 flow.
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

export async function POST(req: NextRequest) {
  try {
    // Require API key with erc8183:create scope
    const auth = await requireApiKey(req, [API_KEY_SCOPES.ERC8183_CREATE]);
    if (auth.error) return auth.error;

    const body = await req.json();

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

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json(
      { ok: false, error: 'prepare_failed', detail: message },
      { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }
}
