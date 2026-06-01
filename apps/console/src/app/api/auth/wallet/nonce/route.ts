/**
 * GET /api/auth/wallet/nonce?address=0x...
 *
 * Generates a signing nonce bound to the given wallet address.
 * Returns the exact message the client must sign with EIP-191 personal_sign.
 * Client then POSTs the signature to /api/auth/wallet/verify.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateNonce } from '@/lib/auth/wallet-session';

export const dynamic = 'force-dynamic';

const ERROR_CACHE = 'no-store, no-cache, max-age=0';

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');

  if (!address?.trim()) {
    return NextResponse.json(
      { ok: false, error: 'missing_address', detail: 'address query param is required' },
      { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }

  const result = generateNonce(address.trim());

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, detail: result.detail },
      { status: 400, headers: { 'Cache-Control': ERROR_CACHE } },
    );
  }

  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
