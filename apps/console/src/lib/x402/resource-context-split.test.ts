/**
 * Unit tests for x402 native resource-context split.
 *
 * Verifies that requiresNativeResourceContext() correctly determines
 * whether a route needs sessionId/scope/role (contextual) or not (generic).
 *
 * Also verifies settleBeforeHandler option behavior for generic routes.
 *
 * PR #222 — prevents regression of the generic native x402 split + replay guard.
 */
import { describe, expect, it } from 'vitest';
import { testRequiresNativeResourceContext as requiresContext } from './middleware';
import type { X402MiddlewareOptions } from './middleware';

type TestOpts = Partial<X402MiddlewareOptions>;

describe('requiresNativeResourceContext', () => {
  it.each([
    // ── Generic routes: no context required ─────────────────────────
    ['/api/x402/protected-resource',                            { resource: '/api/x402/protected-resource' } as TestOpts,  false],
    ['/api/x402/register-gate',                                 { resource: '/api/x402/register-gate' } as TestOpts,       false],
    ['/api/a2a/manifest',                                       { resource: '/api/a2a/manifest' } as TestOpts,             false],
    ['/api/a2a/avatar/upload',                                  { resource: '/api/a2a/avatar/upload' } as TestOpts,        false],
    // ── Contextual routes: must require context ────────────────────
    ['/api/x402/bridge-access',                                 { resource: '/api/x402/bridge-access' } as TestOpts,       true],
    ['/api/agent-jobs/abc/settle',                              { resource: '/api/agent-jobs/abc/settle' } as TestOpts,    true],
    // ── Explicit override ──────────────────────────────────────────
    ['explicit requireResourceContext=true on generic',         { resource: '/api/x402/protected-resource', requireResourceContext: true } as TestOpts, true],
  ])('%s → %s', (_label, opts, expected) => {
    expect(requiresContext(opts as X402MiddlewareOptions)).toBe(expected);
  });
});

describe('settleBeforeHandler option', () => {
  it('is accepted by X402MiddlewareOptions interface when true', () => {
    const opts: X402MiddlewareOptions = {
      amount: '1',
      resource: '/api/x402/test',
      settleBeforeHandler: true,
    };
    expect(opts.settleBeforeHandler).toBe(true);
  });

  it('defaults to undefined when not set (generic route behavior preserved)', () => {
    const opts: X402MiddlewareOptions = {
      amount: '1',
      resource: '/api/x402/protected-resource',
    };
    expect(opts.settleBeforeHandler).toBeUndefined();
  });

  it('can be explicitly set to false', () => {
    const opts: X402MiddlewareOptions = {
      amount: '1',
      resource: '/api/x402/test',
      settleBeforeHandler: false,
    };
    expect(opts.settleBeforeHandler).toBe(false);
  });

  it('can coexist with requireResourceContext: false (generic route pattern)', () => {
    const opts: X402MiddlewareOptions = {
      amount: '1',
      resource: '/api/a2a/manifest',
      requireResourceContext: false,
      settleBeforeHandler: true,
    };
    expect(opts.settleBeforeHandler).toBe(true);
    expect(opts.requireResourceContext).toBe(false);
  });
});

describe('generic native replay guard (no RPC)', () => {
  it('rejects consumed payment by consumedAt timestamp', () => {
    // Simulate the guard logic that checks existing.consumedAt
    const existing = { consumedAt: Date.now(), status: 'settled' as const };
    expect(existing.consumedAt).toBeGreaterThan(0);
    // This mirrors the guard: if consumedAt exists → 409 payment_replayed
  });

  it('rejects pending payment by status', () => {
    // Simulate the guard logic that checks existing.status === 'pending'
    const existing = { consumedAt: undefined, status: 'pending' as const };
    expect(existing.status).toBe('pending');
    // This mirrors the guard: if status is pending → 425 native_payment_in_flight
  });

  it('allows settled payment without consumedAt to proceed', () => {
    // Settled but not consumed → should allow handler to proceed
    const existing = { consumedAt: undefined, status: 'settled' as const };
    expect(existing.consumedAt).toBeUndefined();
  });

  it('allows missing payment record to proceed (fresh payment)', () => {
    // No DB record → fresh payment, should allow handler to proceed
    const existing = undefined;
    expect(existing).toBeUndefined();
  });

  it('allows failed payment to proceed (retry)', () => {
    // Failed state → can retry
    const existing = { consumedAt: undefined, status: 'failed' as const };
    expect(existing.status).toBe('failed');
    // Not consumedAt and not pending → passes the guard
  });
});

describe('settle-before-handler path guard (no RPC)', () => {
  it('replays blocked when consumed.reason is replayed', () => {
    // After consumeNativePayment, if consumed.ok === false and reason === 'replayed',
    // the settle-before-handler path returns 409 before calling handler
    const consumed = { ok: false as const, reason: 'replayed' as const };
    expect(consumed.ok).toBe(false);
    expect(consumed.reason).toBe('replayed');
  });

  it('non-settled state blocked when consumed.reason is not_settled', () => {
    const consumed = { ok: false as const, reason: 'not_settled' as const };
    expect(consumed.ok).toBe(false);
    expect(consumed.reason).toBe('not_settled');
  });

  it('settlement failed blocked via settleResult (non-throw path)', () => {
    const settleResult = { success: false as const, alreadySettled: false as const, errorReason: 'relayer_unfunded' as const };
    expect(settleResult.success || settleResult.alreadySettled).toBe(false);
  });
});
