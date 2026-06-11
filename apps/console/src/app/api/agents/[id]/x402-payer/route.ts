import { humanJson } from '@/lib/api/human-json';
/**
 * /api/agents/[id]/x402-payer
 *
 * GET:    List active x402 payer for an agent.
 * POST:   Register/update x402 payer EOA for an agent.
 * DELETE: Revoke active x402 payer for an agent.
 *
 * Requires wallet session auth. Only agent controller/owner can manage.
 * Never stores private keys. Only stores public payer addresses.
 *
 * Scope: x402 per-agent payer binding. Does NOT modify ERC-8004 or ERC-8183.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAddress, isAddress } from 'viem';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import {
  resolveSessionFromCookie,
  getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';
import { getActiveAgentAccountForOwner } from '@/lib/agent-accounts/store';
import {
  isAgentAccountRuntimePayerEnabled,
  isAgentAccountServerRailEnabled,
} from '@/lib/agent-accounts/feature-flags';
import type { AgentX402Rail, AgentX402Scope } from '@/lib/x402/agent-payer';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';
const VALID_RAILS = new Set<AgentX402Rail>(['circle-gateway', 'arc-native']);
const VALID_SCOPES = new Set<AgentX402Scope>(['homepage', 'a2a']);

// ── Shared auth helper ─────────────────────────────────────────────────────

async function verifyOwnership(
  req: NextRequest,
  agentId: string,
): Promise<
  | { ok: true; wallet: string; canonicalAgentId: string; controller: string }
  | { ok: false; response: NextResponse }
> {
  const cookieValue = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookieValue) {
    return {
      ok: false,
      response: humanJson(req, { ok: false, error: 'unauthorized', detail: 'Wallet session required' }, { status: 401, headers: { 'Cache-Control': ERROR_CACHE } }),
    };
  }

  const session = await resolveSessionFromCookie(cookieValue);
  if (!session) {
    return {
      ok: false,
      response: humanJson(req, { ok: false, error: 'invalid_session', detail: 'Wallet session is invalid or expired' }, { status: 401, headers: { 'Cache-Control': ERROR_CACHE } }),
    };
  }

  const linkedAgents = await getLinkedErc8004AgentsForController(session.wallet);
  const ownedAgent = linkedAgents.find(
    (a) => a.tokenId === agentId || a.agentId === agentId,
  );
  if (ownedAgent) {
    return {
      ok: true,
      wallet: session.wallet,
      canonicalAgentId: ownedAgent.agentId,
      controller: session.wallet,
    };
  }

  // Check Agent Account-minted agents (controller = linked Circle Agent Account)
  if (isAgentAccountServerRailEnabled()) {
    const agentAccount = await getActiveAgentAccountForOwner(session.wallet);
    if (agentAccount?.agentAccountAddress) {
      const agentAccountLinked = await getLinkedErc8004AgentsForController(
        agentAccount.agentAccountAddress,
      );
      const ownsAccountAgent = agentAccountLinked.find(
        (a) => a.tokenId === agentId || a.agentId === agentId,
      );
      if (ownsAccountAgent) {
        return {
          ok: true,
          wallet: session.wallet,
          canonicalAgentId: ownsAccountAgent.agentId,
          controller: agentAccount.agentAccountAddress,
        };
      }
    }
  }

  return {
    ok: false,
    response: humanJson(req, { ok: false, error: 'forbidden', detail: 'Session wallet does not control this agent' }, { status: 403, headers: { 'Cache-Control': ERROR_CACHE } }),
  };
}

// ── GET: List active payer ─────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: agentId } = await params;

  const auth = await verifyOwnership(req, agentId);
  if (!auth.ok) return auth.response;

  // Optional scope filter
  const scopeFilter = req.nextUrl.searchParams.get('scope') as AgentX402Scope | null;

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('agent_x402_payers')
    .select('id, agent_id, controller_address, payer_address, rail, scope, status, verified_at, revoked_at, created_at, updated_at')
    .eq('agent_id', auth.canonicalAgentId);

  if (scopeFilter && VALID_SCOPES.has(scopeFilter)) {
    query = query.eq('scope', scopeFilter);
  }

  const { data: payers, error } = await query
    .order('created_at', { ascending: false });

  if (error) {
    return humanJson(req, { ok: false, error: 'query_failed', detail: error.message }, { status: 500, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  return humanJson(req, {
      ok: true,
      agentId: auth.canonicalAgentId,
      payers: (payers ?? []).map((row) => ({
        id: row.id,
        agentId: row.agent_id,
        controllerAddress: row.controller_address,
        payerAddress: row.payer_address,
        rail: row.rail,
        scope: row.scope ?? 'homepage',
        status: row.status,
        verifiedAt: row.verified_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    }, { status: 200, headers: { 'Cache-Control': ERROR_CACHE } });
}

// ── POST: Register/update payer ────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: agentId } = await params;

  const auth = await verifyOwnership(req, agentId);
  if (!auth.ok) return auth.response;

  // Parse body
  const body = await req.clone().json().catch(() => ({} as Record<string, unknown>));
  const rawPayer = typeof body.payerAddress === 'string' ? body.payerAddress.trim() : '';
  const rawRail = typeof body.rail === 'string' ? body.rail.trim() : 'circle-gateway';
  const rawScope = typeof body.scope === 'string' ? body.scope.trim() : 'homepage';

  // Validate payer address
  if (!rawPayer || !isAddress(rawPayer)) {
    return humanJson(req, { ok: false, error: 'invalid_payer_address', detail: 'A valid EVM address is required.' }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  // Validate rail
  if (!VALID_RAILS.has(rawRail as AgentX402Rail)) {
    return humanJson(req, { ok: false, error: 'invalid_rail', detail: `Rail must be one of: ${[...VALID_RAILS].join(', ')}` }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  // Validate scope
  if (!VALID_SCOPES.has(rawScope as AgentX402Scope)) {
    return humanJson(req, { ok: false, error: 'invalid_scope', detail: `Scope must be one of: ${[...VALID_SCOPES].join(', ')}` }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  const payerAddress = getAddress(rawPayer);
  const rail = rawRail as AgentX402Rail;
  const scope = rawScope as AgentX402Scope;

  if (scope === 'a2a' && !isAgentAccountRuntimePayerEnabled()) {
    const agentAccount = await getActiveAgentAccountForOwner(auth.wallet);
    if (agentAccount?.agentAccountAddress.toLowerCase() === payerAddress.toLowerCase()) {
      return humanJson(req, { ok: false, error: 'agent_account_runtime_payer_disabled', detail: 'No Agent Wallet runtime payer configured yet.' }, { status: 403, headers: { 'Cache-Control': ERROR_CACHE } });
    }
  }

  const supabase = getSupabaseAdmin();

  // Soft-revoke existing active payer for same agent + rail + scope
  const { data: existing } = await supabase
    .from('agent_x402_payers')
    .select('id')
    .eq('agent_id', auth.canonicalAgentId)
    .eq('rail', rail)
    .eq('scope', scope)
    .eq('status', 'active')
    .is('revoked_at', null);

  if (existing && existing.length > 0) {
    await supabase
      .from('agent_x402_payers')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('id', existing.map((r) => r.id));
  }

  // Insert new active payer row.
  // If a concurrent request already inserted an active payer for this agent+rail+scope,
  // the unique partial index will reject. Return 409 active_payer_race.
  const { data: inserted, error: insertError } = await supabase
    .from('agent_x402_payers')
    .insert({
      agent_id: auth.canonicalAgentId,
      controller_address: getAddress(auth.controller),
      payer_address: payerAddress,
      rail,
      scope,
      status: 'active',
      verified_at: new Date().toISOString(),
    })
    .select('id, agent_id, controller_address, payer_address, rail, scope, status, verified_at, created_at')
    .single();

  if (insertError || !inserted) {
    // Postgres unique violation code 23505 — concurrent insert race
    const isUniqueViolation = insertError?.code === '23505' ||
      insertError?.message?.includes('unique') ||
      insertError?.message?.includes('duplicate');
    return humanJson(req, {
        ok: false,
        error: isUniqueViolation ? 'active_payer_race' : 'insert_failed',
        detail: isUniqueViolation
          ? 'Concurrent payer registration detected. Retry the request.'
          : (insertError?.message ?? 'Unknown error'),
      }, { status: isUniqueViolation ? 409 : 500, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  return humanJson(req, {
      ok: true,
      agentId: inserted.agent_id,
      payer: {
        id: inserted.id,
        controllerAddress: inserted.controller_address,
        payerAddress: inserted.payer_address,
        rail: inserted.rail,
        scope: (inserted as Record<string, unknown>).scope ?? 'homepage',
        status: inserted.status,
        verifiedAt: inserted.verified_at,
        createdAt: inserted.created_at,
      },
    }, { status: 200, headers: { 'Cache-Control': ERROR_CACHE } });
}

// ── DELETE: Revoke active payer ────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: agentId } = await params;

  const auth = await verifyOwnership(req, agentId);
  if (!auth.ok) return auth.response;

  // Parse optional rail + scope from query string
  const rail = (req.nextUrl.searchParams.get('rail') || 'circle-gateway') as AgentX402Rail;
  if (!VALID_RAILS.has(rail)) {
    return humanJson(req, { ok: false, error: 'invalid_rail', detail: `Rail must be one of: ${[...VALID_RAILS].join(', ')}` }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  const scope = (req.nextUrl.searchParams.get('scope') || 'homepage') as AgentX402Scope;
  if (!VALID_SCOPES.has(scope)) {
    return humanJson(req, { ok: false, error: 'invalid_scope', detail: `Scope must be one of: ${[...VALID_SCOPES].join(', ')}` }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  const supabase = getSupabaseAdmin();

  // Atomic: single UPDATE with filters, returns updated row or null.
  // No race between select + update.
  const { data: revoked, error: revokeError } = await supabase
    .from('agent_x402_payers')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('agent_id', auth.canonicalAgentId)
    .eq('rail', rail)
    .eq('scope', scope)
    .eq('status', 'active')
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (revokeError) {
    return humanJson(req, { ok: false, error: 'revoke_failed', detail: revokeError.message }, { status: 500, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  if (!revoked) {
    return humanJson(req, { ok: false, error: 'no_active_payer', detail: `No active ${rail} payer found for agent ${auth.canonicalAgentId}` }, { status: 404, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  return humanJson(req, {
      ok: true,
      agentId: auth.canonicalAgentId,
      rail,
      message: `Active ${rail} payer revoked.`,
    }, { status: 200, headers: { 'Cache-Control': ERROR_CACHE } });
}
