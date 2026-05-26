import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { NextRequest, NextResponse } from 'next/server';

const TABLE = 'a2a_api_keys';

export const API_KEY_SCOPES = {
  JOBS_CREATE: 'jobs:create',
  JOBS_CLAIM: 'jobs:claim',
  JOBS_SUBMIT: 'jobs:submit',
  JOBS_VERIFY: 'jobs:verify',
  JOBS_SETTLE: 'jobs:settle',
  AGENT_BRIDGE_WRITE: 'agent_bridge:write',
  AGENT_BRIDGE_RECEIPT: 'agent_bridge:receipt',
  // ERC-8183 escrow job scopes
  ERC8183_CREATE: 'erc8183:create',
  ERC8183_CONFIRM: 'erc8183:confirm',
  ERC8183_CLAIM: 'erc8183:claim',
  ERC8183_RUNNING: 'erc8183:running',
  ERC8183_SUBMIT: 'erc8183:submit',
  ERC8183_COMPLETE: 'erc8183:complete',
  ERC8183_TX: 'erc8183:tx',
} as const;

// ─── Key generation ───────────────────────────────────────────────────────────

/**
 * Generate a new API key for an agent. Returns the raw key (shown once)
 * and stores only a versioned PBKDF2-derived hash in Supabase.
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
 * Verify a bearer token against stored PBKDF2 hashes.
 * Returns the key metadata if valid, null if invalid/revoked.
 * Also updates last_used_at on successful verification.
 */
export async function verifyApiKey(rawKey: string): Promise<VerifiedKey | null> {
  if (!rawKey || !rawKey.startsWith('ak_')) return null;

  const keyPrefix = rawKey.slice(0, 11);
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from(TABLE)
    .select('id, agent_id, scopes, revoked_at, key_hash')
    .eq('key_prefix', keyPrefix)
    .is('revoked_at', null);

  if (error || !data?.length) return null;

  const matched = data.find((row) => {
    if (!row?.key_hash || typeof row.key_hash !== 'string') return false;
    return verifyKeyHash(rawKey, row.key_hash);
  });

  if (!matched) return null;

  // Fire-and-forget last_used_at update.
  supabase
    .from(TABLE)
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', matched.id)
    .then(() => {});

  return {
    id: matched.id,
    agentId: matched.agent_id,
    scopes: matched.scopes ?? [],
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

const API_KEY_HASH_VERSION = 'pbkdf2_v1';
const API_KEY_HASH_ITERATIONS = 210_000;
const API_KEY_HASH_KEYLEN = 32;
const API_KEY_HASH_DIGEST = 'sha256';
const API_KEY_HASH_PEPPER = process.env.A2A_API_KEY_PEPPER;

function getApiKeyPepper(): string {
  if (!API_KEY_HASH_PEPPER && process.env.NODE_ENV === 'production') {
    throw new Error('A2A_API_KEY_PEPPER is required in production');
  }

  return API_KEY_HASH_PEPPER ?? 'dev-only-a2a-api-key-pepper';
}

function hashKey(raw: string): string {
  const salt = randomBytes(16).toString('base64url');
  const digest = pbkdf2Sync(
    `${getApiKeyPepper()}:${raw}`,
    salt,
    API_KEY_HASH_ITERATIONS,
    API_KEY_HASH_KEYLEN,
    API_KEY_HASH_DIGEST,
  ).toString('hex');

  return [
    API_KEY_HASH_VERSION,
    API_KEY_HASH_ITERATIONS,
    API_KEY_HASH_DIGEST,
    salt,
    digest,
  ].join('$');
}

function verifyKeyHash(raw: string, storedHash: string): boolean {
  const [version, iterationsRaw, digest, salt, expectedHex] = storedHash.split('$');

  if (version !== API_KEY_HASH_VERSION) return false;
  if (!iterationsRaw || !digest || !salt || !expectedHex) return false;
  if (digest !== API_KEY_HASH_DIGEST) return false;

  const pepper = getApiKeyPepper();
  const iterations = Number(iterationsRaw);
  if (!Number.isSafeInteger(iterations) || iterations <= 0) return false;

  let actual: Buffer;
  let expected: Buffer;

  try {
    actual = pbkdf2Sync(
      `${pepper}:${raw}`,
      salt,
      iterations,
      API_KEY_HASH_KEYLEN,
      digest,
    );

    expected = Buffer.from(expectedHex, 'hex');
  } catch {
    return false;
  }

  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}
