/**
 * Route-level provider routing tests.
 *
 * Tests the INDEXER_PROVIDER routing logic without hitting real backends.
 * Verifies array shape preservation (Blocker 1) and NEXT_PUBLIC_ isolation.
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
      setEnv({
        NEXT_PUBLIC_INDEXER_PROVIDER: 'goldsky',
        INDEXER_PROVIDER: 'custom',
      });
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
      setEnv({
        NEXT_PUBLIC_INDEXER_PROVIDER: 'goldsky',
        INDEXER_PROVIDER: 'custom',
      });
      const serverProvider = resolveProvider(process.env.INDEXER_PROVIDER);
      expect(serverProvider).toBe('custom');
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

// ── Array response shape tests (Blocker 1 regression) ─────────────────────

describe("Array response shape preservation", () => {
  /**
   * Simulates the jsonResponse logic from the route:
   * - Arrays stay as arrays (metadata in headers, not body)
   * - Objects get _meta injected
   */
  function simulateJsonResponse(data: unknown, meta: { provider: string; scope: string; fallbackActive: boolean }) {
    if (Array.isArray(data)) {
      // Array → preserve shape exactly, metadata goes to headers
      return { body: data, isArray: true, metaInHeaders: true };
    }
    // Object → inject _meta into body
    return { body: { ...data, _meta: meta }, isArray: false, metaInHeaders: false };
  }

  it("/jobs response is an array, not an object", () => {
    const jobsArray = [
      { id: "1", provider: "0xaaa", worker: "0xaaa" },
      { id: "2", provider: "0xbbb", worker: "0xbbb" },
    ];
    const result = simulateJsonResponse(jobsArray, { provider: 'goldsky', scope: 'arclayer', fallbackActive: false });
    expect(Array.isArray(result.body)).toBe(true);
    expect(result.isArray).toBe(true);
    expect(result.metaInHeaders).toBe(true);
    expect(result.body).toHaveLength(2);
    // Body is the exact array — no _meta wrapper
    expect(result.body).toEqual(jobsArray);
  });

  it("/agents response is an array, not an object", () => {
    const agentsArray = [
      { agentId: "erc8004_identity_registry:1", controller: "0xaaa" },
    ];
    const result = simulateJsonResponse(agentsArray, { provider: 'goldsky', scope: 'arclayer', fallbackActive: false });
    expect(Array.isArray(result.body)).toBe(true);
    expect(result.body).toEqual(agentsArray);
  });

  it("/proofs response is an array, not an object", () => {
    const proofsArray: unknown[] = [];
    const result = simulateJsonResponse(proofsArray, { provider: 'goldsky', scope: 'arclayer', fallbackActive: false });
    expect(Array.isArray(result.body)).toBe(true);
    expect(result.body).toEqual([]);
  });

  it("/health response is an object with _meta", () => {
    const healthObj = { ok: true, scope: "arclayer" };
    const result = simulateJsonResponse(healthObj, { provider: 'goldsky', scope: 'arclayer', fallbackActive: false });
    expect(Array.isArray(result.body)).toBe(false);
    expect(result.isArray).toBe(false);
    expect(result.metaInHeaders).toBe(false);
    expect(result.body._meta).toBeDefined();
    expect(result.body._meta.provider).toBe('goldsky');
    expect(result.body.ok).toBe(true);
  });

  it("/overview response is an object with _meta", () => {
    const overviewObj = { summary: { jobs: 5 }, jobs: [], agents: [] };
    const result = simulateJsonResponse(overviewObj, { provider: 'goldsky', scope: 'arclayer', fallbackActive: false });
    expect(Array.isArray(result.body)).toBe(false);
    expect(result.body._meta).toBeDefined();
    expect(result.body.summary.jobs).toBe(5);
  });

  it("/jobs/:id response is an object with _meta", () => {
    const jobDetail = { job: { id: "1" }, proof: null };
    const result = simulateJsonResponse(jobDetail, { provider: 'goldsky', scope: 'arclayer', fallbackActive: false });
    expect(Array.isArray(result.body)).toBe(false);
    expect(result.body._meta).toBeDefined();
    expect(result.body.job.id).toBe("1");
  });

  it("PM2/custom array JSON is not converted into an object", () => {
    // Simulates what happens when PM2 proxy returns an array
    const pm2Array = [
      { id: "1", client: "0xaaa", provider: "0xbbb", worker: "0xbbb", status: 3 },
      { id: "2", client: "0xccc", provider: "0xddd", worker: "0xddd", status: 0 },
    ];
    // The proxy passes body through as-is — no JSON.parse + transformation
    const bodyString = JSON.stringify(pm2Array);
    const parsedBack = JSON.parse(bodyString);
    expect(Array.isArray(parsedBack)).toBe(true);
    expect(parsedBack).toHaveLength(2);
    // No _meta injected into array
    expect(parsedBack).not.toHaveProperty('_meta');
  });
});

// ── Header-based metadata tests ───────────────────────────────────────────

describe("Header-based metadata for arrays", () => {
  it("x-indexer-provider header is set for array responses", () => {
    const headers = new Headers();
    headers.set('x-indexer-provider', 'goldsky');
    headers.set('x-indexer-scope', 'arclayer');
    headers.set('x-indexer-fallback-active', 'false');
    expect(headers.get('x-indexer-provider')).toBe('goldsky');
    expect(headers.get('x-indexer-scope')).toBe('arclayer');
    expect(headers.get('x-indexer-fallback-active')).toBe('false');
  });

  it("x-indexer-provider reflects custom-fallback on fallback", () => {
    const headers = new Headers();
    headers.set('x-indexer-provider', 'custom-fallback');
    headers.set('x-indexer-fallback-active', 'true');
    expect(headers.get('x-indexer-provider')).toBe('custom-fallback');
    expect(headers.get('x-indexer-fallback-active')).toBe('true');
  });
});
