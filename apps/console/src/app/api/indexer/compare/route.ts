/**
 * Indexer comparison API route — compares PM2/SQLite vs Goldsky/Supabase.
 *
 * Security:
 *   - Disabled by default (INDEXER_COMPARE_ENABLED=false)
 *   - Optional Bearer token auth (INDEXER_COMPARE_TOKEN)
 *   - verbose=1 requires token even if non-verbose compare is enabled
 *   - Never exposes raw Supabase rows, secrets, or internal URLs
 *   - Errors are redacted — no raw exception text in response
 *
 * @module apps/console/src/app/api/indexer/compare/route
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { buildComparisonReport } from "@/lib/indexer-compare";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Server-only env reads (NEVER NEXT_PUBLIC_*) ────────────────────────────

const INDEXER_COMPARE_ENABLED =
  (process.env.INDEXER_COMPARE_ENABLED ?? "false") === "true";

const INDEXER_COMPARE_TOKEN = process.env.INDEXER_COMPARE_TOKEN || "";

const INDEXER_INTERNAL_URL =
  process.env.INDEXER_INTERNAL_URL || "http://localhost:3535";

// ── PM2 fetcher with safe defaults ─────────────────────────────────────────

type Pm2Result<T> = { ok: boolean; data: T; warningCode?: string };

const PM2_WARNING_CODES: Record<string, string> = {
  "/health": "custom_health_unreachable",
  "/jobs?limit=500&includeExpired=true": "custom_jobs_unreachable",
  "/agents": "custom_agents_unreachable",
  "/proofs": "custom_proofs_unreachable",
  "/overview": "custom_overview_unreachable",
};

/** Fetch a PM2 endpoint. Returns safe defaults on failure — never returns non-array for array endpoints. */
async function fetchPm2Json<T>(
  path: string,
  fallback: T,
): Promise<Pm2Result<T>> {
  const url = `${INDEXER_INTERNAL_URL}${path}`;
  const warningCode = PM2_WARNING_CODES[path];
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[indexer-compare] PM2 ${path} returned HTTP ${res.status}`);
      return { ok: false, data: fallback, warningCode };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    console.error(`[indexer-compare] PM2 ${path} unreachable:`, err instanceof Error ? err.message : String(err));
    return { ok: false, data: fallback, warningCode };
  }
}

// ── Auth check ─────────────────────────────────────────────────────────────

function sha256hex(input: string): Buffer {
  return createHash("sha256").update(input, "utf8").digest();
}

function checkAuth(request: NextRequest, requireToken: boolean): {
  ok: boolean;
  status: number;
  errorCode?: string;
} {
  if (!INDEXER_COMPARE_ENABLED) {
    return { ok: false, status: 403, errorCode: "compare_disabled" };
  }

  if (!requireToken && !INDEXER_COMPARE_TOKEN) {
    return { ok: true, status: 200 };
  }

  // Require Bearer token
  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!bearerToken) {
    return { ok: false, status: 401, errorCode: "auth_required" };
  }

  // Hash-based constant-time compare: hash both, compare fixed-length hashes
  const providedHash = sha256hex(bearerToken);
  const expectedHash = sha256hex(INDEXER_COMPARE_TOKEN);
  const match = timingSafeEqual(providedHash, expectedHash);

  if (!match) {
    return { ok: false, status: 403, errorCode: "invalid_token" };
  }

  return { ok: true, status: 200 };
}

// ── GET handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const verbose = request.nextUrl.searchParams.get("verbose") === "1";

  // verbose=1 requires token even if non-verbose compare is enabled
  const auth = checkAuth(request, verbose || !!INDEXER_COMPARE_TOKEN);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.errorCode },
      { status: auth.status },
    );
  }

  // ── Fetch from PM2/SQLite indexer (safe defaults) ───────────────────
  const [customHealthRes, customJobsRes, customAgentsRes, customProofsRes, customOverviewRes] =
    await Promise.all([
      fetchPm2Json<Record<string, unknown>>("/health", { ok: false }),
      fetchPm2Json<Record<string, unknown>[]>("/jobs?limit=500&includeExpired=true", []),
      fetchPm2Json<Record<string, unknown>[]>("/agents", []),
      fetchPm2Json<Record<string, unknown>[]>("/proofs", []),
      fetchPm2Json<Record<string, unknown>>("/overview", { summary: { jobs: 0, agents: 0, settledJobs: 0, fundedJobs: 0 }, jobs: [], agents: [], proofs: [] }),
    ]);

  // ── Fetch from Goldsky/Supabase reader ──────────────────────────────
  let goldskyHealth: Record<string, unknown> = { ok: false, error: "not loaded" };
  let goldskyJobs: Record<string, unknown>[] = [];
  let goldskyAgents: Record<string, unknown>[] = [];
  let goldskyProofs: Record<string, unknown>[] = [];
  let goldskyOverview: Record<string, unknown> = {};
  let goldskyMaxBlock = 0;
  let goldskyError: string | null = null;

  try {
    const {
      readGoldskyHealth,
      readGoldskyJobs,
      readGoldskyAgents,
      readGoldskyProofs,
      readGoldskyOverview,
    } = await import("@/lib/goldsky-supabase-indexer");

    // Fetch raw data once, build all projections from the snapshot
    const health = await readGoldskyHealth();
    goldskyHealth = health as unknown as Record<string, unknown>;

    const [jobs, agents, proofs, overview] = await Promise.all([
      readGoldskyJobs(),
      readGoldskyAgents(),
      readGoldskyProofs(),
      readGoldskyOverview(),
    ]);

    goldskyJobs = jobs as unknown as Record<string, unknown>[];
    goldskyAgents = agents as unknown as Record<string, unknown>[];
    goldskyProofs = proofs as unknown as Record<string, unknown>[];
    goldskyOverview = overview as unknown as Record<string, unknown>;

    // Derive max block from job events (highest block_number in projected set)
    for (const job of goldskyJobs) {
      const block = Number(job.createdAtBlock ?? 0);
      if (block > goldskyMaxBlock) goldskyMaxBlock = block;
    }
  } catch (err) {
    goldskyError = "goldsky_reader_error";
    goldskyHealth = { ok: false, error: goldskyError };
    // Log detailed error server-side only
    console.error("[indexer-compare] Goldsky reader failed:", err instanceof Error ? err.message : String(err));
  }

  // ── Build comparison report ─────────────────────────────────────────
  const report = buildComparisonReport({
    customHealth: customHealthRes.data,
    goldskyHealth,
    customJobs: customJobsRes.data,
    goldskyJobs,
    customAgents: customAgentsRes.data,
    goldskyAgents,
    customProofs: customProofsRes.data,
    goldskyProofs,
    customOverview: customOverviewRes.data,
    goldskyOverview,
    goldskyMaxBlock,
  });

  // ── Warnings (stable codes only — no raw URLs, secrets, or exception text) ──
  const warnings: string[] = [];
  if (customHealthRes.warningCode) warnings.push(customHealthRes.warningCode);
  if (customJobsRes.warningCode) warnings.push(customJobsRes.warningCode);
  if (customAgentsRes.warningCode) warnings.push(customAgentsRes.warningCode);
  if (customProofsRes.warningCode) warnings.push(customProofsRes.warningCode);
  if (customOverviewRes.warningCode) warnings.push(customOverviewRes.warningCode);
  if (goldskyError) warnings.push(goldskyError);

  const response: Record<string, unknown> = {
    ...report,
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  // Verbose mode: include the raw fetched arrays for debugging
  if (verbose) {
    response.customJobs = customJobsRes.data;
    response.goldskyJobs = goldskyJobs;
    response.customAgents = customAgentsRes.data;
    response.goldskyAgents = goldskyAgents;
  } else {
    // Non-verbose: strip any raw arrays that might have leaked into report
    delete (response as any).customJobs;
    delete (response as any).goldskyJobs;
    delete (response as any).customAgents;
    delete (response as any).goldskyAgents;
  }

  return NextResponse.json(response, {
    headers: {
      "cache-control": "no-store",
      "x-indexer-compare": "true",
    },
  });
}
