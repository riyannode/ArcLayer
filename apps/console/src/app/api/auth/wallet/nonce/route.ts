import { humanJson } from '@/lib/api/human-json';
/**
 * GET /api/auth/wallet/nonce?address=0x...
 *
 * Generates a signing nonce bound to the given wallet address.
 * Stores sha256(nonce) in Supabase. Returns raw nonce + exact message to client.
 */

import { NextRequest } from 'next/server';
import { generateNonce } from '@/lib/auth/wallet-session';

export const dynamic = 'force-dynamic';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');

  if (!address?.trim()) {
    return humanJson(req, { ok: false, error: 'missing_address', detail: 'address query param is required' }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  const result = await generateNonce(address.trim());

  if (!result.ok) {
    return humanJson(req, { ok: false, error: result.error, detail: result.detail }, { status: 400, headers: { 'Cache-Control': ERROR_CACHE } });
  }

  return humanJson(req, result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
