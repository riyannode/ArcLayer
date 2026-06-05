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
import type { AgentX402Rail } from '@/lib/x402/agent-payer';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';
const VALID_RAILS = new Set<AgentX402Rail>(['circle-gateway', 'arc-native']);

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
      response: NextResponse.json(
        { ok: false, error: 'unauthorized', detail: 'Wallet session required' },
        { status: 401, headers: { 'Cache-Control': ERROR_CACHE } },
      ),
    };
  }

  const session = await resolveSessionFromCookie(cookieValue);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'invalid_session', detail: 'Wallet session is invalid or expired' },
        { status: 401, headers: { 'Cache-Control': ERROR_CACHE } },
      ),
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

  return {
    ok: false,
    response: NextResponse.json(
      { ok: false, error: 'forbidden', detail: 'Session wallet does not control this agent' },
      { status: 403, headers: { 'Cache-Control': ERROR_CACHE } },
    ),
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

  const supabase = getSupabaseAdmin();
  const { data: payers, error } = await supabase
    .from('agent_x402_payers')
    .select('id, agent_id, controller_address, payer_address, rail, status, verified_at, revoked_at, created_at, updated_at')
    .eq('agent_id', auth.canonicalAgentId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'query_failed', detail: error.message },
      { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      agentId: auth.canonicalAgentId,
      payers: (payers ?? []).map((row) => ({
        id: row.id,
        agentId: row.agent_id,
        controllerAddress: row.controller_address,
        payerAddress: row.payer_address,
        rail: row.rail,
        status: row.status,
        verifiedAt: row.verified_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    },
    { status: 200, headers: { 'Cache-Control': ERROR_CACHE } },
  );
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

  // Validate payer address
  if (!rawPayer || !isAddress(rawPayer)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payer_address', detail: 'A valid EVM address is required.' },
      { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }

  // Validate rail
  if (!VALID_RAILS.has(rawRail as AgentX402Rail)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_rail', detail: `Rail must be one of: ${[...VALID_RAILS].join(', ')}` },
      { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }

  const payerAddress = getAddress(rawPayer);
  const rail = rawRail as AgentX402Rail;
  const supabase = getSupabaseAdmin();

  // Soft-revoke existing active payer for same agent + rail
  const { data: existing } = await supabase
    .from('agent_x402_payers')
    .select('id')
    .eq('agent_id', auth.canonicalAgentId)
    .eq('rail', rail)
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

  // Insert new active payer row
  const { data: inserted, error: insertError } = await supabase
    .from('agent_x402_payers')
    .insert({
      agent_id: auth.canonicalAgentId,
      controller_address: getAddress(auth.controller),
      payer_address: payerAddress,
      rail,
      status: 'active',
      verified_at: new Date().toISOString(),
    })
    .select('id, agent_id, controller_address, payer_address, rail, status, verified_at, created_at')
    .single();

  if (insertError || !inserted) {
    return NextResponse.json(
      { ok: false, error: 'insert_failed', detail: insertError?.message ?? 'Unknown error' },
      { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      agentId: inserted.agent_id,
      payer: {
        id: inserted.id,
        controllerAddress: inserted.controller_address,
        payerAddress: inserted.payer_address,
        rail: inserted.rail,
        status: inserted.status,
        verifiedAt: inserted.verified_at,
        createdAt: inserted.created_at,
      },
    },
    { status: 200, headers: { 'Cache-Control': ERROR_CACHE } },
  );
}

// ── DELETE: Revoke active payer ────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: agentId } = await params;

  const auth = await verifyOwnership(req, agentId);
  if (!auth.ok) return auth.response;

  // Parse optional rail from query string
  const rail = (req.nextUrl.searchParams.get('rail') || 'circle-gateway') as AgentX402Rail;
  if (!VALID_RAILS.has(rail)) {
    return NextResponse.json(
      { ok: false, error: 'invalid_rail', detail: `Rail must be one of: ${[...VALID_RAILS].join(', ')}` },
      { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }

  const supabase = getSupabaseAdmin();

  // Find active payer
  const { data: active } = await supabase
    .from('agent_x402_payers')
    .select('id')
    .eq('agent_id', auth.canonicalAgentId)
    .eq('rail', rail)
    .eq('status', 'active')
    .is('revoked_at', null)
    .limit(1)
    .maybeSingle();

  if (!active) {
    return NextResponse.json(
      { ok: false, error: 'no_active_payer', detail: `No active ${rail} payer found for agent ${auth.canonicalAgentId}` },
      { status: 404, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }

  // Soft-revoke
  const { error: revokeError } = await supabase
    .from('agent_x402_payers')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', active.id);

  if (revokeError) {
    return NextResponse.json(
      { ok: false, error: 'revoke_failed', detail: revokeError.message },
      { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      agentId: auth.canonicalAgentId,
      rail,
      message: `Active ${rail} payer revoked.`,
    },
    { status: 200, headers: { 'Cache-Control': ERROR_CACHE } },
  );
}
