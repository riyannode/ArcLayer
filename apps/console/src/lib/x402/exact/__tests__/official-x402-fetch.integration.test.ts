import { describe, expect, it } from 'vitest';
import { createSigner, wrapFetchWithPayment } from 'x402-fetch';

const RUN = process.env.RUN_X402_FETCH_E2E === '1';
const BASE_URL = process.env.X402_E2E_BASE_URL || 'http://127.0.0.1:3000';
const PRIVATE_KEY = process.env.X402_E2E_PRIVATE_KEY;

const maybeDescribe = RUN ? describe : describe.skip;

maybeDescribe('official x402-fetch integration: /api/x402-demo/protected', () => {
  it('unlocks protected endpoint using official x402-fetch client', async () => {
    if (!PRIVATE_KEY) throw new Error('X402_E2E_PRIVATE_KEY is required when RUN_X402_FETCH_E2E=1');

    // Official client smoke test. Arc Native uses CAIP-2 eip155:5042002.
    // If upstream x402-fetch does not yet list Arc Testnet as SupportedEVMNetworks,
    // this test will fail loudly instead of hiding client incompatibility.
    const signer = await createSigner('eip155:5042002', PRIVATE_KEY as `0x${string}`);
    const paidFetch = wrapFetchWithPayment(fetch, signer);

    const res = await paidFetch(`${BASE_URL}/api/x402-demo/protected`, {
      method: 'GET',
      headers: { 'X-Payment-Rail': 'arc-native' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('PAYMENT-RESPONSE')).toBeTruthy();
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.unlocked).toBe(true);
  }, 60_000);
});

// Non-E2E contract: package must be resolvable in normal unit runs.
describe('official x402-fetch package contract', () => {
  it('exports official fetch wrapper APIs', () => {
    expect(typeof createSigner).toBe('function');
    expect(typeof wrapFetchWithPayment).toBe('function');
  });
});
