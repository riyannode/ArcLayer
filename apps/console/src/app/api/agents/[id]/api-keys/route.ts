import { humanJson } from '@/lib/api/human-json';
/**
 * /api/agents/[id]/api-keys
 *
 * POST: Create a new API key for an agent. Returns raw key once.
 * GET: List API key metadata (never returns raw key).
 * Requires wallet session auth. Only agent controller/owner can access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createApiKey, API_KEY_SCOPES } from '@/lib/a2a/auth';
import { API_KEY_PRESETS, API_KEY_PRESET_ID_SET } from '@/lib/agent-onboarding/api-key-presets';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import {
  resolveSessionFromCookie,
  getLinkedErc8004AgentsForController,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/wallet-session';
import { getActiveAgentAccountForOwner } from '@/lib/agent-accounts/store';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';

const SCOPE_PRESETS = Object.fromEntries(
  Object.entries(API_KEY_PRESETS).map(([id, preset]) => [id, preset.scopes]),
) as Record<string, string[]>;
const VALID_PRESETS = API_KEY_PRESET_ID_SET;
const ALL_SCOPES = Object.values(API_KEY_SCOPES) as string[];
const VALID_SCOPE_SET = new Set(ALL_SCOPES);
const LABEL_MAX_LENGTH = 80;

// ── Shared auth helper ──────────────────────────────────────────────────

/**
 * Verify wallet session + agent ownership.
 * Supports both:
 * - Legacy EOA-minted agents (controller = owner EOA)
 * - New Agent Account-minted agents (controller = linked Circle Agent Account)
 */
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

  // Check legacy EOA-minted agents
  const linkedAgents = await getLinkedErc8004AgentsForController(session.wallet);
  const ownsEoaAgent = linkedAgents.some(
    (a) => a.tokenId === agentId || a.agentId === agentId,
  );
  if (ownsEoaAgent) {
    return { ok: true, wallet: session.wallet };
  }

  // Check Agent Account-minted agents (controller = linked Circle Agent Account)
  try {
    const agentAccount = await getActiveAgentAccountForOwner(session.wallet);
    if (agentAccount?.agentAccountAddress) {
      const agentAccountLinked = await getLinkedErc8004AgentsForController(
        agentAccount.agentAccountAddress,
      );
      const ownsAccountAgent = agentAccountLinked.some(
        (a) => a.tokenId === agentId || a.agentId === agentId,
      );
      if (ownsAccountAgent) {
        return { ok: true, wallet: session.wallet };
      }
    }
  } catch {
    // Treat Agent Account lookup failures as non-ownership, not as a leaked server error.
  }

  return {
    ok: false,
    response: humanJson(req, { ok: false, error: 'forbidden', detail: 'Session wallet does not control this agent' }, { status: 403, headers: { 'Cache-Control': ERROR_CACHE } }),
  };
}

// ── POST: Create API key ────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: agentId } = await params;

    const auth = await verifyOwnership(req, agentId);
    if (!auth.ok) return auth.response;

    // Parse body
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return humanJson(req, { ok: false, error: 'invalid_body', detail: 'Request body must be a JSON object' }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    // Validate label
    let label: string | undefined;
    if (body.label !== undefined) {
      if (typeof body.label !== 'string') {
        return humanJson(req, { ok: false, error: 'invalid_label', detail: 'label must be a string' }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
      }
      const trimmed = body.label.trim();
      if (trimmed.length > LABEL_MAX_LENGTH) {
        return humanJson(req, { ok: false, error: 'invalid_label', detail: `label must be ${LABEL_MAX_LENGTH} characters or fewer` }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
      }
      if (trimmed.length > 0) label = trimmed;
    }

    // Resolve scopes from preset or explicit list
    let scopes: string[] | undefined;
    if (body.preset !== undefined) {
      // Reject deprecated worker preset
      if (body.preset === 'worker') {
        return humanJson(req, { ok: false, error: 'deprecated_preset', detail: 'worker preset is deprecated for ERC-8183; use provider' }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
      }
      if (typeof body.preset !== 'string' || !VALID_PRESETS.has(body.preset)) {
        return humanJson(req, { ok: false, error: 'invalid_preset', detail: `preset must be one of: ${[...VALID_PRESETS].join(', ')}` }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
      }
      scopes = SCOPE_PRESETS[body.preset];
    } else if (body.scopes !== undefined) {
      if (!Array.isArray(body.scopes)) {
        return humanJson(req, { ok: false, error: 'invalid_scopes', detail: 'scopes must be a string array' }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
      }
      // Validate every scope
      const invalid: string[] = [];
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const s of body.scopes) {
        if (typeof s !== 'string') {
          return humanJson(req, { ok: false, error: 'invalid_scope', detail: 'Each scope must be a string' }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
        }
        if (!VALID_SCOPE_SET.has(s)) {
          invalid.push(s);
        }
        if (!seen.has(s)) {
          seen.add(s);
          deduped.push(s);
        }
      }
      if (invalid.length > 0) {
        return humanJson(req, { ok: false, error: 'invalid_scope', detail: `Unknown scopes: ${invalid.join(', ')}` }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
      }
      scopes = deduped.length > 0 ? deduped : undefined;
    }

    const result = await createApiKey({
      agentId,
      label,
      scopes,
      createdBy: auth.wallet,
    });

    if (!result.ok) {
      return humanJson(req, { ok: false, error: 'create_failed', detail: result.error }, { status: 500, headers: { 'Cache-Control': ERROR_CACHE } });
    }

    return humanJson(req, { ok: true, key: result.key, keyPrefix: result.keyPrefix, id: result.id }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return humanJson(req, { ok: false, error: 'api_key_create_failed', detail: message }, { status: 500, headers: { 'Cache-Control': ERROR_CACHE } });
  }
}

// ── GET: List API keys (metadata only, never raw key) ───────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: agentId } = await params;

    const auth = await verifyOwnership(req, agentId);
    if (!auth.ok) return auth.response;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('a2a_api_keys')
      .select('id, key_prefix, label, scopes, created_at, last_used_at, revoked_at')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });

    if (error) {
      return humanJson(req, { ok: false, error: 'list_failed', detail: error.message }, { status: 500, headers: { 'Cache-Control': ERROR_CACHE } });
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

    return humanJson(req, { ok: true, keys }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return humanJson(req, { ok: false, error: 'api_key_list_failed', detail: message }, { status: 500, headers: { 'Cache-Control': ERROR_CACHE } });
  }
}
