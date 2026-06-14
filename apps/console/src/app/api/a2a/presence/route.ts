import { humanJson } from '@/lib/api/human-json';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listAgentPresenceByCategory, upsertAgentPresence } from '@/lib/a2a/live-events';
import { requireApiKey } from '@/lib/a2a/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Recursive secret-field rejection.
 * Scans all keys in plain objects and arrays.
 * Matches case-insensitive after normalizing separators (underscores, hyphens, spaces removed).
 * Exact blocklist — no broad substring like "key" or "private".
 */
const SECRET_KEY_PATTERNS = [
  'privatekey',
  'apikey',
  'secret',
  'token',
  'authorization',
  'keyhash',
  'password',
  'mnemonic',
  'seed',
];

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[\s_-]+/g, '');
  for (const pattern of SECRET_KEY_PATTERNS) {
    if (normalized.includes(pattern)) return true;
  }
  return false;
}

function hasSecretFields(value: unknown, depth = 0): boolean {
  if (depth > 8) return false; // guard against deeply nested structures
  if (!value || typeof value !== 'object') return false;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (hasSecretFields(item, depth + 1)) return true;
    }
    return false;
  }

  // Plain object — check keys
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (isSecretKey(key)) return true;
    // Recurse into nested plain objects
    const child = (value as Record<string, unknown>)[key];
    if (child && typeof child === 'object' && hasSecretFields(child, depth + 1)) return true;
  }

  return false;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category')?.trim() || 'prediction-market-bots';

  try {
    const presence = await listAgentPresenceByCategory(category);

    return humanJson(request, {
      ok: true,
      source: process.env.A2A_AGENT_ROSTER_SOURCE || 'local-indexer',
      category,
      total: presence.length,
      presence,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return humanJson(request, {
      ok: false,
      source: 'local-indexer',
      category,
      total: 0,
      presence: [],
      error: 'local_indexer_unavailable',
      timestamp: new Date().toISOString(),
    });
  }
}

export async function POST(request: NextRequest) {
  // Read body once
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return humanJson(request, { ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // Reject secret fields — recursive scan of all keys in body
  if (hasSecretFields(body)) {
    return humanJson(request, { ok: false, error: 'secret_fields_rejected' }, { status: 400 });
  }

  // Authenticate via per-agent ARCLAYER_API_KEY
  const runtimeType = body.runtimeType as string | undefined;

  if (runtimeType === 'x402-agent') {
    // Reserved for future x402 agent heartbeat — not yet implemented
    return humanJson(request, { ok: false, error: 'unsupported_runtime_type', hint: 'x402:presence not yet implemented' }, { status: 501 });
  }

  const auth = await requireApiKey(request, ['presence:write']);
  if (auth.error) return auth.error;

  // Enforce key.agentId === body.agentId
  if (auth.key.agentId !== body.agentId) {
    return humanJson(request, { ok: false, error: 'agent_id_mismatch', key_agent: auth.key.agentId, body_agent: body.agentId }, { status: 403 });
  }

  const result = await upsertAgentPresence({
    agentId: body.agentId,
    agentName: body.agentName,
    status: body.status,
    lastEventType: body.lastEventType ?? 'heartbeat',
    lastEventSummary: body.lastEventSummary ?? 'heartbeat',
    role: body.role ?? undefined,
    runtimeType: body.runtimeType ?? undefined,
    processName: body.processName ?? undefined,
    version: body.version ?? undefined,
    chainId: body.chainId ?? undefined,
    rpcOk: body.rpcOk ?? undefined,
  });

  if (!result.ok) {
    return humanJson(request, { ok: false, error: result.error }, { status: 400 });
  }

  return humanJson(request, { ok: true });
}
