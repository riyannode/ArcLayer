/**
 * /api/agents/[agentId]/api-keys
 *
 * POST: Create a new API key for an agent. Returns raw key once.
 * GET: List API key metadata (never returns raw key).
 * Requires wallet session auth. Only agent controller/owner can access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createApiKey, API_KEY_SCOPES } from '@/lib/a2a/auth';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import {
  resolveSessionFromCookie,
  getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';

const SCOPE_PRESETS: Record<string, string[]> = {
  worker: [
    API_KEY_SCOPES.ERC8183_CLAIM,
    API_KEY_SCOPES.ERC8183_RUNNING,
    API_KEY_SCOPES.ERC8183_SUBMIT,
    API_KEY_SCOPES.ERC8183_TX,
  ],
  client: [
    API_KEY_SCOPES.ERC8183_CREATE,
    API_KEY_SCOPES.ERC8183_CONFIRM,
    API_KEY_SCOPES.ERC8183_TX,
  ],
  evaluator: [
    API_KEY_SCOPES.ERC8183_COMPLETE,
    API_KEY_SCOPES.ERC8183_TX,
  ],
};

const ALL_SCOPES = Object.values(API_KEY_SCOPES);

// ── Shared auth helper ──────────────────────────────────────────────────

async function verifyOwnership(
  req: NextRequest,
  agentId: string,
): Promise<
  | { ok: true; wallet: string }
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
  const ownsAgent = linkedAgents.some(
    (a) => a.tokenId === agentId || a.agentId === agentId,
  );
  if (!ownsAgent) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'forbidden', detail: 'Session wallet does not control this agent' },
        { status: 403, headers: { 'Cache-Control': ERROR_CACHE } },
      ),
    };
  }

  return { ok: true, wallet: session.wallet };
}

// ── POST: Create API key ────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;

    const auth = await verifyOwnership(req, agentId);
    if (!auth.ok) return auth.response;

    // Parse body
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: 'invalid_body', detail: 'Request body must be a JSON object' },
        { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    const label = typeof body.label === 'string' ? body.label.trim() : undefined;

    // Resolve scopes from preset or explicit list
    let scopes: string[] | undefined;
    if (typeof body.preset === 'string' && SCOPE_PRESETS[body.preset]) {
      scopes = SCOPE_PRESETS[body.preset];
    } else if (Array.isArray(body.scopes)) {
      const valid = body.scopes.filter(
        (s: unknown): s is string =>
          typeof s === 'string' && (ALL_SCOPES as readonly string[]).includes(s),
      );
      scopes = valid.length > 0 ? valid : undefined;
    }

    const result = await createApiKey({
      agentId,
      label,
      scopes,
      createdBy: auth.wallet,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: 'create_failed', detail: result.error },
        { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    return NextResponse.json(
      { ok: true, key: result.key, keyPrefix: result.keyPrefix, id: result.id },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json(
      { ok: false, error: 'api_key_create_failed', detail: message },
      { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }
}

// ── GET: List API keys (metadata only, never raw key) ───────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  try {
    const { agentId } = await params;

    const auth = await verifyOwnership(req, agentId);
    if (!auth.ok) return auth.response;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('a2a_api_keys')
      .select('id, key_prefix, label, scopes, created_at, last_used_at, revoked_at')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'list_failed', detail: error.message },
        { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
      );
    }

    const keys = (data ?? []).map((row) => ({
      id: row.id,
      keyPrefix: row.key_prefix,
      label: row.label,
      scopes: row.scopes ?? [],
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      status: row.revoked_at ? 'revoked' : 'active',
    }));

    return NextResponse.json(
      { ok: true, keys },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return NextResponse.json(
      { ok: false, error: 'api_key_list_failed', detail: message },
      { status: 500, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }
}
