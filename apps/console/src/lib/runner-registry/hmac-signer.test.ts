/**
 * Tests for HMAC signer — verifies Console→Runner signature compatibility.
 *
 * The signer must produce signatures that runner-core auth.ts can verify.
 * We inline the runner-core verification logic here to test the round-trip
 * without adding a runtime dependency.
 */
import { describe, it, expect } from 'vitest';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  signDispatchRequest,
  buildHmacPayload,
  sha256Hex,
  hmacSha256Hex,
  HMAC_TIMESTAMP_HEADER,
  HMAC_NONCE_HEADER,
  HMAC_SIGNATURE_HEADER,
} from './hmac-signer';

// ── Inlined runner-core verification (matches auth.ts exactly) ────────────

function runnerSha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function runnerHmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

function runnerBuildPayload(method: string, path: string, ts: string, nonce: string, bodyHash: string): string {
  return `${method}\n${path}\n${ts}\n${nonce}\n${bodyHash}`;
}

function runnerVerifySignature(secret: string, payload: string, received: string): void {
  if (!received.startsWith('sha256=') || received.length !== 71) {
    throw new Error('Invalid HMAC signature format');
  }
  const receivedHex = received.slice(7);
  const expectedHex = runnerHmacSha256(secret, payload);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const receivedBuf = Buffer.from(receivedHex, 'hex');
  if (!timingSafeEqual(expectedBuf, receivedBuf)) {
    throw new Error('Invalid HMAC signature');
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('sha256Hex', () => {
  it('produces correct SHA-256 hex digest for string', () => {
    const expected = createHash('sha256').update('hello').digest('hex');
    expect(sha256Hex('hello')).toBe(expected);
  });

  it('produces correct SHA-256 hex digest for buffer', () => {
    const buf = Buffer.from('hello');
    const expected = createHash('sha256').update(buf).digest('hex');
    expect(sha256Hex(buf)).toBe(expected);
  });

  it('produces 64-char hex string', () => {
    expect(sha256Hex('test')).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('hmacSha256Hex', () => {
  it('produces correct HMAC-SHA256', () => {
    const expected = createHmac('sha256', 'secret').update('payload').digest('hex');
    expect(hmacSha256Hex('secret', 'payload')).toBe(expected);
  });
});

describe('buildHmacPayload', () => {
  it('produces correct format', () => {
    const payload = buildHmacPayload('POST', '/run', '2026-01-01T00:00:00.000Z', 'nonce-123', 'abc123');
    expect(payload).toBe('POST\n/run\n2026-01-01T00:00:00.000Z\nnonce-123\nabc123');
  });
});

describe('signDispatchRequest', () => {
  const secret = 'test-secret-at-least-16-chars';

  it('returns all three required headers', () => {
    const headers = signDispatchRequest({
      secret,
      method: 'POST',
      path: '/runtime/run',
      body: '{"taskId":"t1"}',
    });

    expect(headers[HMAC_TIMESTAMP_HEADER]).toBeDefined();
    expect(headers[HMAC_NONCE_HEADER]).toBeDefined();
    expect(headers[HMAC_SIGNATURE_HEADER]).toBeDefined();
  });

  it('signature starts with sha256=', () => {
    const headers = signDispatchRequest({
      secret,
      method: 'POST',
      path: '/runtime/run',
      body: '{"taskId":"t1"}',
    });

    expect(headers[HMAC_SIGNATURE_HEADER]).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('timestamp is valid ISO date', () => {
    const headers = signDispatchRequest({
      secret,
      method: 'POST',
      path: '/runtime/run',
      body: '{}',
    });

    const ts = new Date(headers[HMAC_TIMESTAMP_HEADER]);
    expect(ts.getTime()).toBeGreaterThan(0);
  });

  it('nonce is a UUID', () => {
    const headers = signDispatchRequest({
      secret,
      method: 'POST',
      path: '/runtime/run',
      body: '{}',
    });

    expect(headers[HMAC_NONCE_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('different bodies produce different signatures', () => {
    const h1 = signDispatchRequest({ secret, method: 'POST', path: '/run', body: '{"a":1}' });
    const h2 = signDispatchRequest({ secret, method: 'POST', path: '/run', body: '{"a":2}' });
    expect(h1[HMAC_SIGNATURE_HEADER]).not.toBe(h2[HMAC_SIGNATURE_HEADER]);
  });
});

describe('round-trip: Console signs → Runner verifies', () => {
  const secret = 'test-secret-at-least-16-chars-long';

  it('runner-core verifyHmacSignature accepts Console-signed request', () => {
    const method = 'POST';
    const path = '/runtime/run';
    const body = JSON.stringify({ taskId: 't1', agentId: '123', protocol: 'generic', role: 'provider', input: {} });
    const bodyBuf = Buffer.from(body);

    // Console signs
    const headers = signDispatchRequest({ secret, method, path, body });

    // Reconstruct what runner-core expects
    const bodyHash = runnerSha256Buffer(bodyBuf);
    const payload = runnerBuildPayload(
      method,
      path,
      headers[HMAC_TIMESTAMP_HEADER],
      headers[HMAC_NONCE_HEADER],
      bodyHash,
    );

    // Verify using inlined runner-core logic — should NOT throw
    expect(() =>
      runnerVerifySignature(secret, payload, headers[HMAC_SIGNATURE_HEADER])
    ).not.toThrow();
  });

  it('runner-core verifyHmacSignature rejects wrong secret', () => {
    const method = 'POST';
    const path = '/runtime/run';
    const body = '{"taskId":"t1"}';
    const bodyBuf = Buffer.from(body);

    const headers = signDispatchRequest({ secret, method, path, body });

    const bodyHash = runnerSha256Buffer(bodyBuf);
    const payload = runnerBuildPayload(
      method,
      path,
      headers[HMAC_TIMESTAMP_HEADER],
      headers[HMAC_NONCE_HEADER],
      bodyHash,
    );

    // Verify with WRONG secret — should throw
    expect(() =>
      runnerVerifySignature('wrong-secret-16-chars-long', payload, headers[HMAC_SIGNATURE_HEADER])
    ).toThrow();
  });

  it('runner-core verifyHmacSignature rejects tampered body', () => {
    const method = 'POST';
    const path = '/runtime/run';
    const body = '{"taskId":"t1"}';
    const tamperedBody = '{"taskId":"TAMPERED"}';
    const tamperedBuf = Buffer.from(tamperedBody);

    const headers = signDispatchRequest({ secret, method, path, body });

    // Runner uses tampered body hash
    const tamperedHash = runnerSha256Buffer(tamperedBuf);
    const payload = runnerBuildPayload(
      method,
      path,
      headers[HMAC_TIMESTAMP_HEADER],
      headers[HMAC_NONCE_HEADER],
      tamperedHash,
    );

    // Should reject — body hash mismatch
    expect(() =>
      runnerVerifySignature(secret, payload, headers[HMAC_SIGNATURE_HEADER])
    ).toThrow();
  });
});
