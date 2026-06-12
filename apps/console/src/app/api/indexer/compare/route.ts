/**
 * Indexer comparison API route — compares PM2/SQLite vs Goldsky/Supabase.
 *
 * SERVER-ONLY — reads from both providers and produces a structured diff report.
 * Does NOT change the default provider. Does NOT switch production routing.
 *
 * Usage:
 *   GET /api/indexer/compare
 *
 * Query params:
 *   ?verbose=1  — include full data arrays in response (for debugging)
 *
 * @module apps/console/src/app/api/indexer/compare/route
 */

import { NextRequest, NextResponse } from "next/server";
import { buildComparisonReport } from "@/lib/indexer-compare";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ── Server-only env reads ──────────────────────────────────────────────────

const INDEXER_INTERNAL_URL =
  process.env.INDEXER_INTERNAL_URL || "http://localhost:3535";

// ── PM2 fetcher ────────────────────────────────────────────────────────────

async function fetchPm2Endpoint<T>(
  path: string,
): Promise<{ ok: boolean; data: T; error?: string }> {
  const url = `${INDEXER_INTERNAL_URL}${path}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return {
        ok: false,
        data: {} as T,
        error: `PM2 returned HTTP ${res.status} for ${path}`,
      };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      data: {} as T,
      error: `PM2 unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── GET handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const verbose = request.nextUrl.searchParams.get("verbose") === "1";

  // ── Fetch from PM2/SQLite indexer ───────────────────────────────────
  const [customHealthRes, customJobsRes, customAgentsRes, customProofsRes, customOverviewRes] =
    await Promise.all([
      fetchPm2Endpoint<Record<string, unknown>>("/health"),
      fetchPm2Endpoint<Record<string, unknown>[]>("/jobs"),
      fetchPm2Endpoint<Record<string, unknown>[]>("/agents"),
      fetchPm2Endpoint<Record<string, unknown>[]>("/proofs"),
      fetchPm2Endpoint<Record<string, unknown>>("/overview"),
    ]);

  const customHealthError =
    !customHealthRes.ok ? customHealthRes.error : null;

  // ── Fetch from Goldsky/Supabase reader ──────────────────────────────
  let goldskyHealth: Record<string, unknown> = { ok: false, error: "not loaded" };
  let goldskyJobs: Record<string, unknown>[] = [];
  let goldskyAgents: Record<string, unknown>[] = [];
  let goldskyProofs: Record<string, unknown>[] = [];
  let goldskyOverview: Record<string, unknown> = {};
  let goldskyError: string | null = null;

  try {
    const {
      readGoldskyHealth,
      readGoldskyJobs,
      readGoldskyAgents,
      readGoldskyProofs,
      readGoldskyOverview,
    } = await import("@/lib/goldsky-supabase-indexer");

    const [health, jobs, agents, proofs, overview] = await Promise.all([
      readGoldskyHealth(),
      readGoldskyJobs(),
      readGoldskyAgents(),
      readGoldskyProofs(),
      readGoldskyOverview(),
    ]);

    goldskyHealth = health as unknown as Record<string, unknown>;
    goldskyJobs = jobs as unknown as Record<string, unknown>[];
    goldskyAgents = agents as unknown as Record<string, unknown>[];
    goldskyProofs = proofs as unknown as Record<string, unknown>[];
    goldskyOverview = overview as unknown as Record<string, unknown>;
  } catch (err) {
    goldskyError = err instanceof Error ? err.message : String(err);
    goldskyHealth = { ok: false, error: goldskyError };
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
  });

  // ── Attach raw errors if any ────────────────────────────────────────
  const warnings: string[] = [];
  if (customHealthError) warnings.push(`custom: ${customHealthError}`);
  if (goldskyError) warnings.push(`goldsky: ${goldskyError}`);

  const response: Record<string, unknown> = {
    ...report,
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  // In non-verbose mode, strip the full arrays to keep response small
  if (!verbose) {
    // Keep summary counts but remove the heavy arrays
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
