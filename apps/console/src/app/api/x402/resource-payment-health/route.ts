import { humanJson } from '@/lib/api/human-json';
/**
 * x402 Resource Payment Health Check — server-only diagnostic route.
 *
 * Verifies the x402_resource_payments Supabase table is reachable before
 * any settlement is allowed. Does NOT create payments, settle, or expose secrets.
 *
 * Runtime: nodejs — no Edge, no client-side import.
 */
import 'server-only';
import { NextRequest } from 'next/server';
import {
  assertResourcePaymentStoreReady,
  buildResourcePaymentKey,
} from '@/lib/x402/resource-payment-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyAuth(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') || '';
  const apiKey = process.env.ARCLAYER_API_KEY || '';
  if (!apiKey) return true; // no key configured = auth disabled
  return auth.replace(/^Bearer\s+/i, '').trim() === apiKey.trim();
}

export async function GET(req: NextRequest) {
  if (!verifyAuth(req)) {
    return humanJson(req, { ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const envInfo = {
    hasNextPublicSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasSupabaseServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    protocolTxMode: process.env.PROTOCOL_TX_MODE || 'not_set',
  };

  const sampleKey = buildResourcePaymentKey({
    resource: '/api/x402/bridge-access',
    sessionId: 'healthcheck',
    scope: 'external_trace',
    role: 'executor',
  });

  let tableReachable = false;
  let canRead = false;
  let error: string | null = null;

  try {
    await assertResourcePaymentStoreReady();
    tableReachable = true;
    canRead = true;
  } catch (err) {
    error = err instanceof Error ? err.message : 'unknown_error';
  }

  return humanJson(req, {
    ok: tableReachable,
    tableReachable,
    canRead,
    env: envInfo,
    sampleKey,
    ...(error ? { error } : {}),
  });
}
