import { createHash, randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { NextRequest, NextResponse } from 'next/server';

const TABLE = 'a2a_api_keys';

// ─── Key generation ───────────────────────────────────────────────────────────

/**
 * Generate a new API key for an agent. Returns the raw key (shown once)
 * and stores only the SHA-256 hash in Supabase.
 */
export async function createApiKey(input: {
  agentId: string;
  label?: string;
  scopes?: string[];
  createdBy: string;
}): Promise<{ ok: true; key: string; keyPrefix: string; id: string } | { ok: false; error: string }> {
  const raw = `ak_${randomBytes(24).toString('base64url')}`;
  const keyHash = hashKey(raw);
  const keyPrefix = raw.slice(0, 11); // "ak_" + 8 chars

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      agent_id: input.agentId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      label: input.label ?? null,
      scopes: input.scopes ?? ['jobs:claim', 'jobs:submit'],
      created_by: input.createdBy.toLowerCase(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('[auth] createApiKey error', error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true, key: raw, keyPrefix, id: data.id };
}

// ─── Key verification ─────────────────────────────────────────────────────────

export type VerifiedKey = {
  id: string;
  agentId: string;
  scopes: string[];
};

/**
 * Verify a bearer token against stored hashes.
 * Returns the key metadata if valid, null if invalid/revoked.
 * Also updates last_used_at on successful verification.
 */
export async function verifyApiKey(rawKey: string): Promise<VerifiedKey | null> {
  if (!rawKey || !rawKey.startsWith('ak_')) return null;

  const keyHash = hashKey(rawKey);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from(TABLE)
    .select('id, agent_id, scopes, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;

  // Fire-and-forget last_used_at update
  supabase
    .from(TABLE)
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return {
    id: data.id,
    agentId: data.agent_id,
    scopes: data.scopes ?? [],
  };
}

// ─── Key revocation ───────────────────────────────────────────────────────────

export async function revokeApiKey(keyId: string, agentId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('agent_id', agentId);

  if (error) {
    console.error('[auth] revokeApiKey error', error.message);
    return false;
  }
  return true;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express-style middleware for Next.js route handlers.
 * Extracts Bearer token from Authorization header, verifies it,
 * and attaches the verified key info to the request headers for downstream use.
 *
 * Usage:
 *   const auth = await requireApiKey(req, 'jobs:claim');
 *   if (auth.error) return auth.error;
 *   // auth.key.agentId is the authenticated agent
 */
export async function requireApiKey(
  req: NextRequest,
  requiredScope?: string | string[],
): Promise<{ key: VerifiedKey; error?: never } | { key?: never; error: NextResponse }> {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'missing_api_key', hint: 'Set Authorization: Bearer ak_...' },
        { status: 401 },
      ),
    };
  }

  const key = await verifyApiKey(token);
  if (!key) {
    return {
      error: NextResponse.json(
        { ok: false, error: 'invalid_api_key' },
        { status: 401 },
      ),
    };
  }

  if (requiredScope) {
    const requiredScopes = Array.isArray(requiredScope) ? requiredScope : [requiredScope];
    if (!requiredScopes.some((scope) => key.scopes.includes(scope))) {
      return {
        error: NextResponse.json(
          { ok: false, error: 'insufficient_scope', required: requiredScopes, have: key.scopes },
          { status: 403 },
        ),
      };
    }
  }

  return { key };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
