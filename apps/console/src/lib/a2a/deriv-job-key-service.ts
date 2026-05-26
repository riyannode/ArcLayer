import { verifyMessage, getAddress, isAddress } from 'viem';
import { getSupabaseAdmin } from '@/lib/x402/supabaseClient';
import { getExternalAgent, type ExternalRegistryAgent } from './external-registry';
import { createApiKey } from './auth';
import {
  getDerivJobKeyPolicy,
  DERIV_JOB_TYPE_DEFAULT,
  type DerivJobKeyRole,
} from './deriv-job-key-policy';
import { buildDerivJobKeyMessage } from './deriv-job-key-message';
import type { NextResponse } from 'next/server';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;
const TABLE = 'a2a_api_keys';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DerivJobKeyOwnerCheck =
  | {
      ok: true;
      agent: ExternalRegistryAgent;
      ownerAddress: string;
      role: DerivJobKeyRole;
      policy: NonNullable<ReturnType<typeof getDerivJobKeyPolicy>>;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export type DerivJobKeyEntry = {
  id: string;
  keyPrefix: string;
  label: string | null;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

// ─── Owner verification ─────────────────────────────────────────────────────

/**
 * Verify wallet ownership + agent approval + role validity in one call.
 *
 * Steps:
 * 1. Validate timestamp freshness
 * 2. Normalize EVM address
 * 3. Lookup external agent by agentId
 * 4. Verify agent.status === 'approved'
 * 5. Verify connected wallet matches agent.owner/address
 * 6. Verify wallet signature
 * 7. Resolve role policy
 *
 * Returns { ok: true, ... } on success or { ok: false, response } on failure.
 */
export async function verifyDerivJobKeyOwnerRequest(input: {
  agentId: string;
  ownerAddress?: string;
  signature?: string;
  timestamp?: number;
  role?: string;
  requestId?: string;
  /** Override the action for rotate/revoke — default is 'create_deriv_a2a_job_key' */
  action?: 'create_deriv_a2a_job_key' | 'rotate_deriv_a2a_job_key' | 'revoke_deriv_a2a_job_key';
}): Promise<DerivJobKeyOwnerCheck> {
  // 1. Validate agentId
  const agentId = decodeURIComponent((input.agentId || '').trim());
  if (!agentId) {
    const { NextResponse } = await import('next/server');
    return { ok: false, response: NextResponse.json({ ok: false, error: 'missing_agent_id' }, { status: 400 }) };
  }

  // 2. Validate + normalize address
  const rawAddress = String(input.ownerAddress ?? '').trim();
  if (!rawAddress || !isAddress(rawAddress)) {
    const { NextResponse } = await import('next/server');
    return { ok: false, response: NextResponse.json({ ok: false, error: 'invalid_owner_address' }, { status: 400 }) };
  }
  const ownerAddress = getAddress(rawAddress);

  // 3. Validate signature
  const signature = String(input.signature ?? '').trim();
  if (!signature || !signature.startsWith('0x')) {
    const { NextResponse } = await import('next/server');
    return { ok: false, response: NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 400 }) };
  }

  // 4. Validate timestamp
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp)) {
    const { NextResponse } = await import('next/server');
    return { ok: false, response: NextResponse.json({ ok: false, error: 'invalid_timestamp' }, { status: 400 }) };
  }
  if (Math.abs(Date.now() - timestamp) > MAX_SIGNATURE_AGE_MS) {
    const { NextResponse } = await import('next/server');
    return { ok: false, response: NextResponse.json({ ok: false, error: 'signature_expired' }, { status: 400 }) };
  }

  // 5. Lookup external agent
  const agent = await getExternalAgent(agentId);
  if (!agent) {
    const { NextResponse } = await import('next/server');
    return { ok: false, response: NextResponse.json({ ok: false, error: 'external_agent_not_found' }, { status: 404 }) };
  }

  // 6. Check agent status
  if (agent.status !== 'approved') {
    const { NextResponse } = await import('next/server');
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'external_agent_not_approved', status: agent.status ?? 'unknown' },
        { status: 403 },
      ),
    };
  }

  // 7. Match wallet owner
  const registeredOwner = normalizeAddress(String(agent.owner ?? agent.address ?? ''));
  if (!registeredOwner) {
    const { NextResponse } = await import('next/server');
    return { ok: false, response: NextResponse.json({ ok: false, error: 'external_agent_owner_missing' }, { status: 403 }) };
  }
  if (registeredOwner !== ownerAddress) {
    const { NextResponse } = await import('next/server');
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'wallet_not_agent_owner', expectedOwner: registeredOwner },
        { status: 403 },
      ),
    };
  }

  // 8. Verify signature
  const requestId = String(input.requestId ?? Math.random().toString(36).slice(2));
  const action = input.action ?? 'create_deriv_a2a_job_key';
  const message = buildDerivJobKeyMessage({
    action,
    agentId,
    ownerAddress,
    role: input.role ?? 'deriv-worker',
    jobType: DERIV_JOB_TYPE_DEFAULT,
    timestamp,
    requestId,
  });

  const validSignature = await verifyMessage({
    address: ownerAddress,
    message,
    signature: signature as `0x${string}`,
  }).catch(() => false);

  if (!validSignature) {
    const { NextResponse } = await import('next/server');
    return { ok: false, response: NextResponse.json({ ok: false, error: 'signature_verification_failed' }, { status: 401 }) };
  }

  // 9. Resolve role policy
  const role = (input.role ?? 'deriv-worker').trim().toLowerCase() as DerivJobKeyRole;
  const policy = getDerivJobKeyPolicy(role);
  if (!policy) {
    const { NextResponse } = await import('next/server');
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'invalid_role', hint: `Unknown role "${role}". Use one of: deriv-client, deriv-worker, deriv-evaluator${process.env.NODE_ENV === 'development' ? ', deriv-fullcycle-demo' : ''}` },
        { status: 400 },
      ),
    };
  }

  return { ok: true, agent, ownerAddress, role, policy };
}

// ─── Key management ─────────────────────────────────────────────────────────

/**
 * Create a new Deriv A2A API key with scopes from the role policy.
 * Wraps createApiKey from auth.ts with Deriv-specific label + scope enforcement.
 */
export async function createDerivA2aKey(input: {
  agentId: string;
  role: DerivJobKeyRole;
  policy: NonNullable<ReturnType<typeof getDerivJobKeyPolicy>>;
  ownerAddress: string;
}): Promise<{ ok: true; key: string; keyPrefix: string; id: string } | { ok: false; error: string }> {
  const label = `deriv-${input.role}-${input.agentId}`;

  const result = await createApiKey({
    agentId: input.agentId,
    label,
    scopes: input.policy.scopes,
    createdBy: input.ownerAddress,
  });

  return result;
}

/**
 * Revoke ALL active (non-revoked) keys for a given agentId.
 * Used by rotate flow.
 */
export async function revokeActiveDerivA2aKeys(agentId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from(TABLE)
    .update({ revoked_at: now })
    .eq('agent_id', agentId)
    .is('revoked_at', null);

  if (error) {
    console.error('[deriv-job-key] revokeActive failed', error.message);
    return false;
  }
  return true;
}

/**
 * Revoke a single key by its DB id and agentId.
 * Returns false if key doesn't exist or was already revoked.
 */
export async function revokeDerivA2aKeyById(keyId: string, agentId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error, count } = await supabase
    .from(TABLE)
    .update({ revoked_at: now })
    .eq('id', keyId)
    .eq('agent_id', agentId)
    .is('revoked_at', null)
    .select('id', { count: 'exact', head: false });

  if (error) {
    console.error('[deriv-job-key] revokeById failed', error.message);
    return false;
  }

  return (count ?? 0) > 0;
}

/**
 * List active (non-revoked) keys for an agentId with safe public fields only.
 * Never returns raw keys or key_hash.
 */
export async function listDerivA2aKeyPrefixes(agentId: string): Promise<DerivJobKeyEntry[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from(TABLE)
    .select('id, key_prefix, label, scopes, created_at, last_used_at')
    .eq('agent_id', agentId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[deriv-job-key] listActive failed', error.message);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id ?? ''),
    keyPrefix: String(row.key_prefix ?? ''),
    label: row.label ? String(row.label) : null,
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((s): s is string => typeof s === 'string') : [],
    createdAt: String(row.created_at ?? ''),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
  }));
}

// ─── .env builder ────────────────────────────────────────────────────────────

const BASE_URL = process.env.NEXT_PUBLIC_ARCLAYER_BASE_URL ?? 'https://www.arclayers.xyz';

/**
 * Build a copyable .env output block for the generated key.
 * Role-specific fields are included; Deriv platform keys are shown
 * as commented-out placeholders.
 */
export function buildDerivJobEnv(input: {
  agentId: string;
  rawKey: string;
  role: string;
  jobType?: string;
  baseUrl?: string;
}): string {
  const url = input.baseUrl ?? BASE_URL;
  const jobType = input.jobType ?? DERIV_JOB_TYPE_DEFAULT;
  const lines: string[] = [
    `ARCLAYER_BASE_URL=${url}`,
    `ARCLAYER_API_KEY=${input.rawKey}`,
    `JOB_TYPE=${jobType}`,
  ];

  switch (input.role) {
    case 'deriv-client':
      lines.push(`BUYER_AGENT_ID=${input.agentId}`);
      lines.push('');
      lines.push('LIVE_JOB_SETTLEMENT=false');
      lines.push('X402_PAYER_PRIVATE_KEY=');
      break;
    case 'deriv-worker':
      lines.push(`WORKER_ID=${input.agentId}`);
      lines.push(`PROVIDER_AGENT_ID=${input.agentId}`);
      lines.push('JOB_POLL_INTERVAL_MS=5000');
      break;
    case 'deriv-evaluator':
      lines.push(`VERIFIER_AGENT_ID=${input.agentId}`);
      lines.push('JOB_POLL_INTERVAL_MS=5000');
      break;
    case 'deriv-fullcycle-demo':
      lines.push(`BUYER_AGENT_ID=${input.agentId}`);
      lines.push(`WORKER_ID=${input.agentId}`);
      lines.push(`PROVIDER_AGENT_ID=${input.agentId}`);
      lines.push(`VERIFIER_AGENT_ID=${input.agentId}`);
      lines.push('JOB_POLL_INTERVAL_MS=5000');
      lines.push('');
      lines.push('LIVE_JOB_SETTLEMENT=false');
      lines.push('X402_PAYER_PRIVATE_KEY=');
      break;
  }

  lines.push('');
  lines.push('# Deriv platform keys stay local to this bot VPS.');
  lines.push('# ArcLayer never stores these values.');
  lines.push('# DERIV_API_KEY=your_deriv_token_here');
  lines.push('# DERIV_APP_ID=your_deriv_app_id_here');

  if (input.role === 'deriv-fullcycle-demo') {
    lines.push('');
    lines.push('# Demo only. Do not use one fullcycle key for untrusted production agents.');
  }

  return lines.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeAddress(value: string): string | null {
  if (!isAddress(value)) return null;
  return getAddress(value);
}
