/**
 * GET /api/auth/wallet/nonce
 *
 * Returns a fresh nonce for wallet signing.
 * Client signs `buildNonceSignMessage(wallet, nonce)` with EIP-191 personal_sign,
 * then POSTs the signature to /api/auth/wallet/verify.
 */

import { NextResponse } from 'next/server';
import { generateNonce, buildNonceSignMessage } from '@/lib/auth/wallet-session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { nonce, expiresAt } = generateNonce();

  // We don't know the wallet yet at nonce-time, so we return the template.
  // Client fills in wallet address and builds the final message.
  const messageTemplate = buildNonceSignMessage('<WALLET>', nonce);

  return NextResponse.json(
    {
      ok: true,
      nonce,
      expiresAt,
      messageTemplate,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
