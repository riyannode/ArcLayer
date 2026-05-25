/**
 * Unit tests for x402 native resource-context split.
 *
 * Verifies that requiresNativeResourceContext() correctly determines
 * whether a route needs sessionId/scope/role (contextual) or not (generic).
 *
 * PR #222 — prevents regression of the generic native x402 split.
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
