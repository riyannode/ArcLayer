import test from 'node:test';
import assert from 'node:assert/strict';
import { ArcLayerApi } from './arclayer-api.js';

test('ArcLayerApi sends API keys as Authorization Bearer tokens', async () => {
  const calls: Array<{ input: string | URL; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: input as string | URL, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const api = new ArcLayerApi('https://arclayers.test', 'ak_test_123');
    await api.claimJob('job_1');

    assert.equal(calls.length, 1);
    const headers = new Headers(calls[0]?.init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer ak_test_123');
    assert.equal(headers.get('x-arclayer-api-key'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
