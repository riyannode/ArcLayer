/**
 * ensureWalletSession(address, signMessageAsync)
 *
 * Ensures an arclayer-wallet-session cookie exists before calling
 * authenticated endpoints. Reuses the existing /api/auth/* flow.
 *
 * Returns { ok: true } if session established, { ok: false, error } otherwise.
 */

export async function ensureWalletSession(
  address: string,
  signMessageAsync: (args: { message: string }) => Promise<`0x${string}`>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // 1. Check if session already exists
    const sessionRes = await fetch('/api/auth/session', { cache: 'no-store' });
    const sessionData = await sessionRes.json();

    if (
      sessionData.authenticated === true &&
      sessionData.wallet?.toLowerCase() === address.toLowerCase()
    ) {
      return { ok: true };
    }

    // 2. Get nonce for this address
    const nonceRes = await fetch(
      `/api/auth/wallet/nonce?address=${encodeURIComponent(address)}`,
    );
    const nonceData = await nonceRes.json();
    if (!nonceRes.ok || !nonceData.ok) {
      return {
        ok: false,
        error: nonceData.detail || nonceData.error || 'Failed to get nonce',
      };
    }

    // 3. Sign the message with wallet
    const signature = await signMessageAsync({
      message: nonceData.message,
    });

    // 4. Verify and create session
    const verifyRes = await fetch('/api/auth/wallet/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet: address,
        nonce: nonceData.nonce,
        signature,
      }),
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || !verifyData.ok) {
      return {
        ok: false,
        error:
          verifyData.detail ||
          verifyData.error ||
          'Signature verification failed',
      };
    }

    return { ok: true };
  } catch (e) {
    // User rejected signing or network error
    const msg = e instanceof Error ? e.message : 'Session establishment failed';
    return { ok: false, error: msg };
  }
}
