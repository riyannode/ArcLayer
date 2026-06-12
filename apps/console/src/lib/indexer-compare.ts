/**
 * Indexer comparison helper — compares PM2/SQLite vs Goldsky/Supabase output.
 *
 * Pure comparison logic — no I/O, no side effects. Takes pre-fetched data
 * from both providers and produces a structured diff report.
 *
 * SERVER-ONLY — only meaningful when both providers have data.
 *
 * @module apps/console/src/lib/indexer-compare
 */

import {
  normalizeJob,
  normalizeAgent,
  normalizeOverview,
  type NormalizedJob,
  type NormalizedAgent,
  type NormalizedOverview,
} from "@/lib/indexer-response-normalizer";

// ── Report types ───────────────────────────────────────────────────────────

export type ProviderHealth = {
  provider: string;
  ok: boolean;
  lastSyncedBlock?: number;
  error?: string;
};

export type CountDiff = {
  label: string;
  custom: number;
  goldsky: number;
  diff: number;
};

export type FieldMismatch = {
  id: string;
  field: string;
  custom: string;
  goldsky: string;
};

export type ComparisonReport = {
  generatedAt: string;
  health: {
    custom: ProviderHealth;
    goldsky: ProviderHealth;
  };
  counts: {
    jobs: CountDiff;
    agents: CountDiff;
    proofs: CountDiff;
    overviewJobs: CountDiff;
    overviewAgents: CountDiff;
    overviewSettled: CountDiff;
    overviewFunded: CountDiff;
  };
  missing: {
    jobIdsInCustomOnly: string[];
    jobIdsInGoldskyOnly: string[];
    agentIdsInCustomOnly: string[];
    agentIdsInGoldskyOnly: string[];
  };
  mismatches: {
    jobFieldDiffs: FieldMismatch[];
    agentFieldDiffs: FieldMismatch[];
  };
  blockLag: {
    customBlock: number;
    goldskyBlock: number;
    lag: number;
  };
  verdict: string;
};

// ── Health comparison ───────────────────────────────────────────────────────

export function compareHealth(
  customHealth: Record<string, unknown>,
  goldskyHealth: Record<string, unknown>,
): { custom: ProviderHealth; goldsky: ProviderHealth } {
  return {
    custom: {
      provider: "custom",
      ok: Boolean(customHealth.ok),
      lastSyncedBlock: Number(customHealth.lastSyncedBlock ?? customHealth.lastSyncedAgentBlock ?? 0),
      error: customHealth.lastSyncError ? String(customHealth.lastSyncError) : undefined,
    },
    goldsky: {
      provider: "goldsky",
      ok: Boolean(goldskyHealth.ok),
      error: goldskyHealth.error ? String(goldskyHealth.error) : undefined,
    },
  };
}

// ── Count comparison ───────────────────────────────────────────────────────

export function compareCounts(
  label: string,
  custom: number,
  goldsky: number,
): CountDiff {
  return {
    label,
    custom,
    goldsky,
    diff: goldsky - custom,
  };
}

// ── ID set comparison ──────────────────────────────────────────────────────

export function compareIdSets(
  customIds: string[],
  goldskyIds: string[],
): { onlyInCustom: string[]; onlyInGoldsky: string[] } {
  const customSet = new Set(customIds);
  const goldskySet = new Set(goldskyIds);

  return {
    onlyInCustom: customIds.filter((id) => !goldskySet.has(id)),
    onlyInGoldsky: goldskyIds.filter((id) => !customSet.has(id)),
  };
}

// ── Job field comparison ───────────────────────────────────────────────────

const JOB_COMPARE_FIELDS: (keyof NormalizedJob)[] = [
  "client",
  "provider",
  "evaluator",
  "status",
  "statusLabel",
  "description",
  "hook",
  "budget",
  "fundedAmount",
];

/**
 * Compare jobs present in both providers on matching IDs.
 * Returns field-level diffs for the key business fields.
 */
export function compareJobFields(
  customJobs: NormalizedJob[],
  goldskyJobs: NormalizedJob[],
): FieldMismatch[] {
  const goldskyMap = new Map(goldskyJobs.map((j) => [j.id, j]));
  const diffs: FieldMismatch[] = [];

  for (const cJob of customJobs) {
    const gJob = goldskyMap.get(cJob.id);
    if (!gJob) continue; // missing entirely — reported in ID comparison

    for (const field of JOB_COMPARE_FIELDS) {
      const cVal = String(cJob[field] ?? "");
      const gVal = String(gJob[field] ?? "");
      if (cVal !== gVal) {
        diffs.push({
          id: cJob.id,
          field,
          custom: cVal,
          goldsky: gVal,
        });
      }
    }
  }

  return diffs;
}

// ── Agent field comparison ─────────────────────────────────────────────────

const AGENT_COMPARE_FIELDS: (keyof NormalizedAgent)[] = [
  "controller",
  "metadataURI",
  "source",
  "registeredAt",
  "reputationScore",
  "score",
];

/**
 * Normalize an agent ID for cross-provider matching.
 * PM2 uses "source:tokenId" format, Goldsky may use raw "tokenId".
 * We normalize to the raw numeric part for matching.
 */
export function normalizeAgentIdForMatch(agentId: string): string {
  // "erc8004_identity_registry:42" → "42"
  // "42" → "42"
  const parts = agentId.split(":");
  return parts[parts.length - 1];
}

/**
 * Compare agents present in both providers on matching IDs.
 * Uses raw numeric tokenId for cross-provider matching since
 * PM2 agentId format is "source:tokenId" and Goldsky is raw "tokenId".
 */
export function compareAgentFields(
  customAgents: NormalizedAgent[],
  goldskyAgents: NormalizedAgent[],
): FieldMismatch[] {
  const goldskyMap = new Map(
    goldskyAgents.map((a) => [normalizeAgentIdForMatch(a.agentId), a]),
  );
  const diffs: FieldMismatch[] = [];

  for (const cAgent of customAgents) {
    const matchKey = normalizeAgentIdForMatch(cAgent.agentId);
    const gAgent = goldskyMap.get(matchKey);
    if (!gAgent) continue;

    for (const field of AGENT_COMPARE_FIELDS) {
      const cVal = String(cAgent[field] ?? "");
      const gVal = String(gAgent[field] ?? "");
      if (cVal !== gVal) {
        diffs.push({
          id: cAgent.agentId,
          field,
          custom: cVal,
          goldsky: gVal,
        });
      }
    }
  }

  return diffs;
}

// ── Overview comparison ────────────────────────────────────────────────────

export function compareOverviewCounts(
  customOverview: NormalizedOverview,
  goldskyOverview: NormalizedOverview,
): {
  overviewJobs: CountDiff;
  overviewAgents: CountDiff;
  overviewSettled: CountDiff;
  overviewFunded: CountDiff;
} {
  return {
    overviewJobs: compareCounts("overview.jobs", customOverview.summary.jobs, goldskyOverview.summary.jobs),
    overviewAgents: compareCounts("overview.agents", customOverview.summary.agents, goldskyOverview.summary.agents),
    overviewSettled: compareCounts("overview.settledJobs", customOverview.summary.settledJobs, goldskyOverview.summary.settledJobs),
    overviewFunded: compareCounts("overview.fundedJobs", customOverview.summary.fundedJobs, goldskyOverview.summary.fundedJobs),
  };
}

// ── Full report builder ────────────────────────────────────────────────────

/**
 * Build a complete comparison report from pre-fetched data.
 *
 * @param customHealth - /health response from PM2 indexer
 * @param goldskyHealth - readGoldskyHealth() result
 * @param customJobs - /jobs response from PM2 indexer
 * @param goldskyJobs - readGoldskyJobs() result
 * @param customAgents - /agents response from PM2 indexer
 * @param goldskyAgents - readGoldskyAgents() result
 * @param customProofs - /proofs response from PM2 indexer
 * @param goldskyProofs - readGoldskyProofs() result
 * @param customOverview - /overview response from PM2 indexer
 * @param goldskyOverview - readGoldskyOverview() result
 */
export function buildComparisonReport(params: {
  customHealth: Record<string, unknown>;
  goldskyHealth: Record<string, unknown>;
  customJobs: Record<string, unknown>[];
  goldskyJobs: Record<string, unknown>[];
  customAgents: Record<string, unknown>[];
  goldskyAgents: Record<string, unknown>[];
  customProofs: Record<string, unknown>[];
  goldskyProofs: Record<string, unknown>[];
  customOverview: Record<string, unknown>;
  goldskyOverview: Record<string, unknown>;
}): ComparisonReport {
  const {
    customHealth,
    goldskyHealth,
    customJobs: rawCustomJobs,
    goldskyJobs: rawGoldskyJobs,
    customAgents: rawCustomAgents,
    goldskyAgents: rawGoldskyAgents,
    customProofs,
    goldskyProofs,
    customOverview: rawCustomOverview,
    goldskyOverview: rawGoldskyOverview,
  } = params;

  // Normalize to consistent shape
  const customJobs = rawCustomJobs.map((j) => normalizeJob(j));
  const goldskyJobs = rawGoldskyJobs.map((j) => normalizeJob(j));
  const customAgents = rawCustomAgents.map((a) => normalizeAgent(a));
  const goldskyAgents = rawGoldskyAgents.map((a) => normalizeAgent(a));
  const customOverview = normalizeOverview(rawCustomOverview);
  const goldskyOverview = normalizeOverview(rawGoldskyOverview);

  // Health
  const health = compareHealth(customHealth, goldskyHealth);

  // Counts
  const jobsCount = compareCounts("jobs", customJobs.length, goldskyJobs.length);
  const agentsCount = compareCounts("agents", customAgents.length, goldskyAgents.length);
  const proofsCount = compareCounts("proofs", customProofs.length, goldskyProofs.length);
  const overviewCounts = compareOverviewCounts(customOverview, goldskyOverview);

  // ID sets
  const customJobIds = customJobs.map((j) => j.id);
  const goldskyJobIds = goldskyJobs.map((j) => j.id);
  const jobIdDiffs = compareIdSets(customJobIds, goldskyJobIds);

  const customAgentIds = customAgents.map((a) => normalizeAgentIdForMatch(a.agentId));
  const goldskyAgentIds = goldskyAgents.map((a) => normalizeAgentIdForMatch(a.agentId));
  const agentIdDiffs = compareIdSets(customAgentIds, goldskyAgentIds);

  // Field mismatches
  const jobFieldDiffs = compareJobFields(customJobs, goldskyJobs);
  const agentFieldDiffs = compareAgentFields(customAgents, goldskyAgents);

  // Block lag
  const customBlock = health.custom.lastSyncedBlock ?? 0;
  const goldskyBlock = 0; // Goldsky doesn't expose a block cursor yet

  // Verdict
  const issues: string[] = [];
  if (!health.custom.ok) issues.push("custom provider unhealthy");
  if (!health.goldsky.ok) issues.push("goldsky provider unhealthy");
  if (jobsCount.diff !== 0) issues.push(`job count mismatch (${jobsCount.diff > 0 ? "+" : ""}${jobsCount.diff})`);
  if (agentsCount.diff !== 0) issues.push(`agent count mismatch (${agentsCount.diff > 0 ? "+" : ""}${agentsCount.diff})`);
  if (jobIdDiffs.onlyInCustom.length > 0) issues.push(`${jobIdDiffs.onlyInCustom.length} jobs missing from goldsky`);
  if (jobIdDiffs.onlyInGoldsky.length > 0) issues.push(`${jobIdDiffs.onlyInGoldsky.length} jobs missing from custom`);
  if (jobFieldDiffs.length > 0) issues.push(`${jobFieldDiffs.length} job field mismatches`);
  if (agentFieldDiffs.length > 0) issues.push(`${agentFieldDiffs.length} agent field mismatches`);

  const verdict = issues.length === 0
    ? "MATCH — both providers return identical data"
    : `DIVERGENCE — ${issues.join("; ")}`;

  return {
    generatedAt: new Date().toISOString(),
    health,
    counts: {
      jobs: jobsCount,
      agents: agentsCount,
      proofs: proofsCount,
      ...overviewCounts,
    },
    missing: {
      jobIdsInCustomOnly: jobIdDiffs.onlyInCustom,
      jobIdsInGoldskyOnly: jobIdDiffs.onlyInGoldsky,
      agentIdsInCustomOnly: agentIdDiffs.onlyInCustom,
      agentIdsInGoldskyOnly: agentIdDiffs.onlyInGoldsky,
    },
    mismatches: {
      jobFieldDiffs: jobFieldDiffs.slice(0, 50), // cap for readability
      agentFieldDiffs: agentFieldDiffs.slice(0, 50),
    },
    blockLag: {
      customBlock,
      goldskyBlock,
      lag: customBlock - goldskyBlock,
    },
    verdict,
  };
}
