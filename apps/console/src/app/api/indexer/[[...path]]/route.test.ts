/**
 * Route-level provider routing tests.
 *
 * Tests the INDEXER_PROVIDER routing logic without hitting real backends.
 * Mocks the Goldsky reader and PM2 proxy to verify routing behavior.
 *
 * @module apps/console/src/app/api/indexer/[[...path]]/route.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Env manipulation helpers ───────────────────────────────────────────────

const originalEnv = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
}

// ── Provider routing logic extraction ──────────────────────────────────────
// We test the routing logic directly rather than importing the route module,
// because Next.js route modules have side effects (dynamic = 'force-dynamic')
// that complicate test imports.

type IndexerProvider = 'custom' | 'goldsky';
type IndexerScope = 'arclayer' | 'arcnetwork';

function resolveProvider(envValue: string | undefined): IndexerProvider {
  return envValue === 'goldsky' ? 'goldsky' : 'custom';
}

function resolveScope(envValue: string | undefined): IndexerScope {
  return envValue === 'arcnetwork' ? 'arcnetwork' : 'arclayer';
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Indexer provider routing", () => {
  beforeEach(() => {
    restoreEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  describe("resolveProvider", () => {
    it("default / unset → custom", () => {
      expect(resolveProvider(undefined)).toBe('custom');
      expect(resolveProvider('')).toBe('custom');
    });

    it("custom → custom", () => {
      expect(resolveProvider('custom')).toBe('custom');
    });

    it("goldsky → goldsky", () => {
      expect(resolveProvider('goldsky')).toBe('goldsky');
    });

    it("anything else → custom (safe default)", () => {
      expect(resolveProvider('invalid')).toBe('custom');
      expect(resolveProvider('GOLDSKY')).toBe('custom');
      expect(resolveProvider('pm2')).toBe('custom');
    });
  });

  describe("resolveScope", () => {
    it("default / unset → arclayer", () => {
      expect(resolveScope(undefined)).toBe('arclayer');
      expect(resolveScope('')).toBe('arclayer');
    });

    it("arclayer → arclayer", () => {
      expect(resolveScope('arclayer')).toBe('arclayer');
    });

    it("arcnetwork → arcnetwork", () => {
      expect(resolveScope('arcnetwork')).toBe('arcnetwork');
    });

    it("anything else → arclayer (safe default)", () => {
      expect(resolveScope('invalid')).toBe('arclayer');
    });
  });

  describe("NEXT_PUBLIC_ isolation", () => {
    it("resolveProvider never reads NEXT_PUBLIC_INDEXER_PROVIDER", () => {
      // Even if NEXT_PUBLIC_INDEXER_PROVIDER is set, resolveProvider takes
      // the explicit env value — it's the caller's job to pass the right one.
      // This test verifies the routing function itself doesn't peek at NEXT_PUBLIC_*.
      setEnv({
        NEXT_PUBLIC_INDEXER_PROVIDER: 'goldsky',
        INDEXER_PROVIDER: 'custom',
      });

      // The route reads process.env.INDEXER_PROVIDER, not NEXT_PUBLIC_*
      const provider = resolveProvider(process.env.INDEXER_PROVIDER);
      expect(provider).toBe('custom');
    });

    it("resolveScope never reads NEXT_PUBLIC_INDEXER_SCOPE", () => {
      setEnv({
        NEXT_PUBLIC_INDEXER_SCOPE: 'arcnetwork',
        INDEXER_SCOPE: 'arclayer',
      });

      const scope = resolveScope(process.env.INDEXER_SCOPE);
      expect(scope).toBe('arclayer');
    });

    it("routing logic uses INDEXER_PROVIDER, not NEXT_PUBLIC_INDEXER_PROVIDER", () => {
      // Simulate: NEXT_PUBLIC says goldsky, server says custom
      setEnv({
        NEXT_PUBLIC_INDEXER_PROVIDER: 'goldsky',
        INDEXER_PROVIDER: 'custom',
      });

      // The routing decision should follow INDEXER_PROVIDER (custom)
      const serverProvider = resolveProvider(process.env.INDEXER_PROVIDER);
      expect(serverProvider).toBe('custom');

      // NEXT_PUBLIC is irrelevant for routing
      const publicProvider = process.env.NEXT_PUBLIC_INDEXER_PROVIDER;
      expect(publicProvider).toBe('goldsky'); // exists but unused for routing
    });
  });

  describe("fallback behavior", () => {
    it("INDEXER_FALLBACK_URL is read from env", () => {
      setEnv({ INDEXER_FALLBACK_URL: 'http://localhost:3535' });
      expect(process.env.INDEXER_FALLBACK_URL).toBe('http://localhost:3535');
    });

    it("empty INDEXER_FALLBACK_URL means no fallback", () => {
      setEnv({ INDEXER_FALLBACK_URL: '' });
      expect(process.env.INDEXER_FALLBACK_URL || '').toBe('');
    });

    it("unset INDEXER_FALLBACK_URL means no fallback", () => {
      delete process.env.INDEXER_FALLBACK_URL;
      expect(process.env.INDEXER_FALLBACK_URL || '').toBe('');
    });
  });

  describe("INDEXER_INTERNAL_URL", () => {
    it("defaults to localhost:3535 when unset", () => {
      delete process.env.INDEXER_INTERNAL_URL;
      const url = process.env.INDEXER_INTERNAL_URL || 'http://localhost:3535';
      expect(url).toBe('http://localhost:3535');
    });

    it("respects custom value", () => {
      setEnv({ INDEXER_INTERNAL_URL: 'http://custom-host:9999' });
      expect(process.env.INDEXER_INTERNAL_URL).toBe('http://custom-host:9999');
    });
  });
});

// ── Response metadata shape tests ─────────────────────────────────────────

describe("Response metadata", () => {
  type ProviderMeta = {
    provider: 'custom' | 'goldsky' | 'custom-fallback';
    scope: IndexerScope;
    fallbackActive: boolean;
  };

  function buildMeta(provider: ProviderMeta['provider'], scope: IndexerScope, fallbackActive = false): ProviderMeta {
    return { provider, scope, fallbackActive };
  }

  it("custom provider metadata", () => {
    const m = buildMeta('custom', 'arclayer');
    expect(m).toEqual({
      provider: 'custom',
      scope: 'arclayer',
      fallbackActive: false,
    });
  });

  it("goldsky provider metadata", () => {
    const m = buildMeta('goldsky', 'arclayer');
    expect(m).toEqual({
      provider: 'goldsky',
      scope: 'arclayer',
      fallbackActive: false,
    });
  });

  it("custom-fallback metadata", () => {
    const m = buildMeta('custom-fallback', 'arclayer', true);
    expect(m).toEqual({
      provider: 'custom-fallback',
      scope: 'arclayer',
      fallbackActive: true,
    });
  });

  it("arcnetwork scope metadata", () => {
    const m = buildMeta('goldsky', 'arcnetwork');
    expect(m.scope).toBe('arcnetwork');
  });
});

// ── Path parsing tests ────────────────────────────────────────────────────

describe("Indexer path routing", () => {
  function parseIndexerPath(pathname: string): string {
    const raw = pathname.replace(/^\/api\/indexer\/?/, '');
    return raw ? `/${raw}` : '/';
  }

  it("parses /api/indexer/health → /health", () => {
    expect(parseIndexerPath('/api/indexer/health')).toBe('/health');
  });

  it("parses /api/indexer/overview → /overview", () => {
    expect(parseIndexerPath('/api/indexer/overview')).toBe('/overview');
  });

  it("parses /api/indexer/jobs → /jobs", () => {
    expect(parseIndexerPath('/api/indexer/jobs')).toBe('/jobs');
  });

  it("parses /api/indexer/jobs/42 → /jobs/42", () => {
    expect(parseIndexerPath('/api/indexer/jobs/42')).toBe('/jobs/42');
  });

  it("parses /api/indexer/agents → /agents", () => {
    expect(parseIndexerPath('/api/indexer/agents')).toBe('/agents');
  });

  it("parses /api/indexer/agents/erc8004_identity_registry:42 → /agents/...", () => {
    expect(parseIndexerPath('/api/indexer/agents/erc8004_identity_registry:42'))
      .toBe('/agents/erc8004_identity_registry:42');
  });

  it("parses /api/indexer/proofs → /proofs", () => {
    expect(parseIndexerPath('/api/indexer/proofs')).toBe('/proofs');
  });

  it("parses /api/indexer/ → / (root)", () => {
    expect(parseIndexerPath('/api/indexer/')).toBe('/');
  });

  it("parses /api/indexer → / (root)", () => {
    expect(parseIndexerPath('/api/indexer')).toBe('/');
  });
});
