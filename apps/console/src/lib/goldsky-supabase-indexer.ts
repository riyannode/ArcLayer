/**
 * Goldsky → Supabase Postgres reader.
 *
 * Reads raw event tables written by Goldsky Turbo/Mirror pipelines and decodes
 * raw EVM logs into typed events using goldsky-raw-log-decoder, then maps
 * them into shared SDK projection helpers from @arclayer/sdk.
 *
 * SERVER-ONLY — uses Supabase service_role key. NEVER import from client
 * components or pages with 'use client'.
 *
 * Raw table schema (raw EVM logs, NOT decoded columns):
 *   - goldsky_erc8183_events_raw: id, block_number, block_hash, transaction_hash,
 *     transaction_index, log_index, address, data, topics, block_timestamp, _gs_op
 *   - goldsky_erc8004_identity_events_raw: same raw schema
 *   - goldsky_erc8004_reputation_events_raw: same raw schema
 *
 * @module apps/console/src/lib/goldsky-supabase-indexer
 */

import "server-only";

import {
  type IndexedJobEvent,
  type IndexedAgentEvent,
  type ProjectedJob,
  type ProjectedAgent,
  type OverviewProjection,
  projectJobsFromEvents as sdkProjectJobs,
  projectAgentsFromEvents as sdkProjectAgents,
  buildOverviewAggregation,
  collectJobWallets,
} from "@arclayer/sdk";
import { getSupabaseAdmin } from "@/lib/x402/supabaseClient";
import {
  buildJobFilter,
  buildAgentFilter,
} from "@/lib/goldsky-scope-filters";
import {
  type RawLogRow,
  decodeIdentityEvents,
  decodeJobEvents,
  filterByBlock,
} from "@/lib/goldsky-raw-log-decoder";

// ── Env config (server-only) ───────────────────────────────────────────────

type IndexerScope = "arclayer" | "arcnetwork";

const INDEXER_SCOPE: IndexerScope =
  process.env.INDEXER_SCOPE === "arcnetwork" ? "arcnetwork" : "arclayer";

const ENV_WALLET_FILTER: string[] = (process.env.ARC_REFERENCE_WALLET_FILTER || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s.startsWith("0x") && s.length === 42);

const ENV_AGENT_ID_FILTER: string[] = (
  process.env.ARC_REFERENCE_AGENT_ID_FILTER || ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const METADATA_PREFIX_FILTER: string[] = (
  process.env.ARC_REFERENCE_METADATA_PREFIX_FILTER ||
  "arclayer://,https://arclayers.xyz"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Postgres schema for Goldsky raw tables. Default "public". */
const GOLDSKY_SCHEMA = process.env.GOLDSKY_POSTGRES_SCHEMA || "public";

/** When set, only query rows where block_number >= this value. */
const GOLDSKY_START_BLOCK = parseInt(process.env.GOLDSKY_START_BLOCK || "0", 10);

// ── Raw table names ────────────────────────────────────────────────────────

const TABLES = {
  erc8183: "goldsky_erc8183_events_raw",
  erc8004Identity: "goldsky_erc8004_identity_events_raw",
  erc8004Reputation: "goldsky_erc8004_reputation_events_raw",
} as const;

/** Tables required for the reader to function. Reputation is reserved/optional. */
const REQUIRED_TABLES = ["erc8183", "erc8004Identity"] as const;

/** Page size for paginated raw event queries. */
const PAGE_SIZE = 5000;

// ── Raw columns to fetch (raw EVM log schema) ──────────────────────────────

const RAW_COLUMNS =
  "id,block_number,block_hash,transaction_hash,transaction_index,log_index,address,data,topics,block_timestamp,_gs_op";

// ── Pagination helper ──────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Fetch all rows from a Goldsky raw table using cursor pagination.
 * Uses block_number + log_index as cursor to avoid offset overhead.
 */
async function fetchAllRawLogs(
  table: string,
  fromBlock?: number,
): Promise<RawLogRow[]> {
  const supabase = getSupabaseAdmin();
  const allRows: RawLogRow[] = [];
  let lastBlock = 0;
  let lastLogIndex = -1;
  const effectiveFromBlock = fromBlock ?? GOLDSKY_START_BLOCK;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = supabase
      .schema(GOLDSKY_SCHEMA)
      .from(table)
      .select(RAW_COLUMNS)
      .order("block_number", { ascending: true })
      .order("log_index", { ascending: true })
      .limit(PAGE_SIZE);

    // Apply start block filter
    if (effectiveFromBlock > 0 && allRows.length === 0) {
      query = query.gte("block_number", effectiveFromBlock);
    }

    // Apply cursor after first page
    if (allRows.length > 0) {
      query = query.or(
        `block_number.gt.${lastBlock},and(block_number.eq.${lastBlock},log_index.gt.${lastLogIndex})`,
      );
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`[goldsky-reader] fetchAllRawLogs(${table}): ${error.message}`);
    }

    const rows = (data ?? []) as unknown as RawLogRow[];
    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) break; // last page

    // Advance cursor
    const last = rows[rows.length - 1];
    lastBlock = Number(last.block_number);
    lastLogIndex = Number(last.log_index);
  }

  return allRows;
}

// ── Normalizers (decoded events → SDK types) ──────────────────────────────

/**
 * Normalize decoded ERC-8183 job events into SDK IndexedJobEvent.
 */
function normalizeJobEvent(decoded: ReturnType<typeof decodeJobEvents>[number]): IndexedJobEvent {
  const base = {
    blockNumber: decoded.blockNumber,
    transactionHash: decoded.transactionHash as `0x${string}`,
    logIndex: decoded.logIndex,
  };

  switch (decoded.kind) {
    case "JobCreated":
      return {
        eventName: "JobCreated",
        ...base,
        jobId: decoded.jobId,
        client: decoded.client as `0x${string}`,
        provider: decoded.provider as `0x${string}`,
        evaluator: decoded.evaluator as `0x${string}`,
        hook: decoded.hook as `0x${string}`,
        expiredAt: decoded.expiredAt,
      };
    case "BudgetSet":
      return {
        eventName: "BudgetSet",
        ...base,
        jobId: decoded.jobId,
        amount: decoded.amount,
      };
    case "JobFunded":
      return {
        eventName: "JobFunded",
        ...base,
        jobId: decoded.jobId,
        client: decoded.client as `0x${string}`,
        amount: decoded.amount,
      };
    case "JobSubmitted":
      return {
        eventName: "JobSubmitted",
        ...base,
        jobId: decoded.jobId,
        deliverable: decoded.deliverable as `0x${string}`,
      };
    case "JobCompleted":
      return {
        eventName: "JobCompleted",
        ...base,
        jobId: decoded.jobId,
        reason: decoded.reason as `0x${string}`,
      };
    case "JobRejected":
      return {
        eventName: "JobRejected",
        ...base,
        jobId: decoded.jobId,
        rejector: decoded.rejector as `0x${string}`,
        reason: decoded.reason as `0x${string}`,
      };
    case "JobExpired":
      return {
        eventName: "JobExpired",
        ...base,
        jobId: decoded.jobId,
      };
  }
}

/**
 * Normalize decoded ERC-8004 identity events into SDK IndexedAgentEvent.
 *
 * Identity events from the on-chain IdentityRegistryUpgradeable:
 * - Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
 *   → from=0x0 means registration; from≠0x0 means ownership transfer
 * - Registered(uint256 indexed agentId, string metadataURI, address indexed owner)
 *   → canonical registration event with metadataURI and owner/controller
 *
 * MetadataSet events are skipped by the decoder (not a registration event).
 */
function normalizeAgentEvent(
  decoded: ReturnType<typeof decodeIdentityEvents>[number],
): IndexedAgentEvent {
  const base = {
    blockNumber: decoded.blockNumber,
    transactionHash: decoded.transactionHash as `0x${string}`,
    logIndex: decoded.logIndex,
  };

  switch (decoded.kind) {
    case "Transfer":
      // ERC-721 Transfer: registration when from=0x0
      return {
        eventName: "Transfer",
        ...base,
        agentId: decoded.tokenId,
        controller: decoded.to as `0x${string}`,
      };
    case "Registered":
      // Registered(uint256 indexed agentId, string metadataURI, address indexed owner)
      // This is the canonical registration event with metadata + controller
      return {
        eventName: "Registered",
        ...base,
        agentId: decoded.agentId,
        controller: decoded.owner as `0x${string}`,
        metadataURI: decoded.metadataURI,
      };
  }
}

// ── Dynamic allowlist loading from Supabase ────────────────────────────────

type DynamicAllowlists = {
  wallets: Set<string>;
  agentIds: Set<string>;
};

function normalizeWallet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  return lower.startsWith("0x") && lower.length === 42 ? lower : null;
}

/**
 * Load dynamic allowlists from Supabase tables (agent_manifests, a2a_jobs).
 * Merges with env allowlists. Env values are additive, not the only source.
 * Returns empty sets if Supabase is unreachable (reader still works with env-only).
 */
export async function loadDynamicAllowlists(): Promise<DynamicAllowlists> {
  const supabase = getSupabaseAdmin();
  const wallets = new Set(ENV_WALLET_FILTER.map((w) => w.toLowerCase()));
  const agentIds = new Set(ENV_AGENT_ID_FILTER.map((id) => id.toLowerCase()));

  // agent_manifests: agent_id, controller, signer
  try {
    const { data } = await supabase
      .from("agent_manifests")
      .select("agent_id,controller,signer")
      .limit(10000);
    for (const row of data ?? []) {
      const aid = row.agent_id != null ? String(row.agent_id).trim().toLowerCase() : "";
      if (aid) agentIds.add(aid);
      for (const key of ["controller", "signer"]) {
        const w = normalizeWallet((row as any)[key]);
        if (w) wallets.add(w);
      }
    }
  } catch {
    // Supabase unreachable or table missing — continue with env-only
  }

  // a2a_jobs: provider, evaluator, claimed_by
  try {
    const { data } = await supabase
      .from("a2a_jobs")
      .select("provider,evaluator,claimed_by")
      .limit(10000);
    for (const row of data ?? []) {
      for (const key of ["provider", "evaluator", "claimed_by"]) {
        const w = normalizeWallet((row as any)[key]);
        if (w) wallets.add(w);
      }
    }
  } catch {
    try {
      const { data } = await supabase
        .from("a2a_jobs")
        .select("provider,evaluator")
        .limit(10000);
      for (const row of data ?? []) {
        for (const key of ["provider", "evaluator"]) {
          const w = normalizeWallet((row as any)[key]);
          if (w) wallets.add(w);
        }
      }
    } catch {
      // Supabase unreachable — continue with env-only
    }
  }

  return { wallets, agentIds };
}

// ── Public reader functions ────────────────────────────────────────────────

/**
 * Health check — verifies Supabase connection and raw table accessibility.
 */
export async function readGoldskyHealth(): Promise<{
  ok: boolean;
  scope: IndexerScope;
  walletFilterActive: boolean;
  agentIdFilterActive: boolean;
  metadataPrefixes: string[];
  tables: Record<string, boolean>;
  startBlock: number;
  dynamicAllowlists?: { wallets: number; agentIds: number };
  error?: string;
}> {
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return {
      ok: false,
      scope: INDEXER_SCOPE,
      walletFilterActive: false,
      agentIdFilterActive: false,
      metadataPrefixes: METADATA_PREFIX_FILTER,
      tables: {},
      startBlock: GOLDSKY_START_BLOCK,
      error: `Supabase client init failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const tableChecks: Record<string, boolean> = {};

  for (const [key, table] of Object.entries(TABLES)) {
    try {
      const { error } = await supabase
        .schema(GOLDSKY_SCHEMA)
        .from(table)
        .select("block_number")
        .limit(1);
      tableChecks[key] = !error;
    } catch {
      tableChecks[key] = false;
    }
  }

  const allRequiredOk = REQUIRED_TABLES.every((key) => tableChecks[key]);

  let dynamicAllowlists: { wallets: number; agentIds: number } | undefined;
  try {
    const dal = await loadDynamicAllowlists();
    dynamicAllowlists = { wallets: dal.wallets.size, agentIds: dal.agentIds.size };
  } catch {
    // ignore
  }

  const hasWalletFilter = (ENV_WALLET_FILTER.length > 0) || (dynamicAllowlists?.wallets ?? 0) > 0;
  const hasAgentIdFilter = (ENV_AGENT_ID_FILTER.length > 0) || (dynamicAllowlists?.agentIds ?? 0) > 0;
  const hasMetadataPrefixes = METADATA_PREFIX_FILTER.length > 0;

  const gateConfigured = INDEXER_SCOPE === "arcnetwork"
    || hasWalletFilter
    || hasAgentIdFilter
    || hasMetadataPrefixes;

  return {
    ok: allRequiredOk && gateConfigured,
    scope: INDEXER_SCOPE,
    walletFilterActive: hasWalletFilter,
    agentIdFilterActive: hasAgentIdFilter,
    metadataPrefixes: METADATA_PREFIX_FILTER,
    tables: tableChecks,
    startBlock: GOLDSKY_START_BLOCK,
    dynamicAllowlists,
    ...((allRequiredOk && gateConfigured) ? {} : {
      error: !allRequiredOk
        ? "One or more required raw tables not accessible"
        : "ArcLayer scope requires at least one attribution source (wallet filter, agent ID filter, or metadata prefix)",
    }),
  };
}

/** Shared fetch + decode helper to avoid redundant Supabase scans. */
async function fetchAllDecoded(fromBlock?: number) {
  const [rawJobRows, rawAgentRows] = await Promise.all([
    fetchAllRawLogs(TABLES.erc8183, fromBlock),
    fetchAllRawLogs(TABLES.erc8004Identity, fromBlock),
  ]);
  const jobEvents = decodeJobEvents(rawJobRows).map(normalizeJobEvent);
  const agentEvents = decodeIdentityEvents(rawAgentRows).map(normalizeAgentEvent);
  return { jobEvents, agentEvents };
}

/**
 * Read projected jobs. Fetches full history once and filters at entity level.
 * Preserves complete job lifecycle even when called with fromBlock.
 */
export async function readGoldskyJobs(fromBlock?: number): Promise<ProjectedJob[]> {
  const allowlists = await loadDynamicAllowlists();
  const { jobEvents } = await fetchAllDecoded(fromBlock);

  if (INDEXER_SCOPE === "arcnetwork") {
    return sdkProjectJobs(jobEvents);
  }

  return sdkProjectJobs(jobEvents, buildJobFilter(allowlists.wallets));
}

/**
 * Read projected agents. Always fetches full job history for wallet collection,
 * then filters agents by creation block if fromBlock is set.
 */
export async function readGoldskyAgents(fromBlock?: number): Promise<ProjectedAgent[]> {
  const allowlists = await loadDynamicAllowlists();
  // Always fetch ALL jobs to collect complete wallet set for attribution
  const [rawJobRows, rawAgentRows] = await Promise.all([
    fetchAllRawLogs(TABLES.erc8183), // NO fromBlock — need all job wallets
    fetchAllRawLogs(TABLES.erc8004Identity, fromBlock),
  ]);
  const decodedJobs = decodeJobEvents(rawJobRows);
  const decodedAgents = decodeIdentityEvents(rawAgentRows);
  const jobEvents = decodedJobs.map(normalizeJobEvent);
  const agentEvents = decodedAgents.map(normalizeAgentEvent);

  if (INDEXER_SCOPE === "arcnetwork") {
    return sdkProjectAgents(agentEvents);
  }

  const jobs = sdkProjectJobs(jobEvents, buildJobFilter(allowlists.wallets));
  const jobWallets = collectJobWallets(jobs);

  return sdkProjectAgents(
    agentEvents,
    buildAgentFilter(allowlists.wallets, allowlists.agentIds, jobWallets),
  );
}

/** Read a single job detail by jobId. */
export async function readGoldskyJobDetail(
  jobId: string,
): Promise<{ job: ProjectedJob; proof: null } | null> {
  const allowlists = await loadDynamicAllowlists();
  const rawRows = await fetchAllRawLogs(TABLES.erc8183);
  const decoded = decodeJobEvents(rawRows);
  const events = decoded.map(normalizeJobEvent);

  const filter = INDEXER_SCOPE === "arcnetwork" ? undefined : buildJobFilter(allowlists.wallets);
  const jobs = sdkProjectJobs(events, filter);
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;
  return { job, proof: null };
}

/** Read all projected agents from Goldsky raw tables. */
export async function readGoldskyAgents(): Promise<ProjectedAgent[]> {
  const allowlists = await loadDynamicAllowlists();
  const [rawJobRows, rawAgentRows] = await Promise.all([
    fetchAllRawLogs(TABLES.erc8183),
    fetchAllRawLogs(TABLES.erc8004Identity),
  ]);
  const decodedJobs = decodeJobEvents(rawJobRows);
  const decodedAgents = decodeIdentityEvents(rawAgentRows);
  const jobEvents = decodedJobs.map(normalizeJobEvent);
  const agentEvents = decodedAgents.map(normalizeAgentEvent);

  if (INDEXER_SCOPE === "arcnetwork") {
    return sdkProjectAgents(agentEvents);
  }

  const jobs = sdkProjectJobs(jobEvents, buildJobFilter(allowlists.wallets));
  const jobWallets = collectJobWallets(jobs);

  return sdkProjectAgents(
    agentEvents,
    buildAgentFilter(allowlists.wallets, allowlists.agentIds, jobWallets),
  );
}

/**
 * Read overview aggregation from Goldsky raw tables.
 * Uses a single shared fetch to avoid redundant Supabase scans.
 */
export async function readGoldskyOverview(): Promise<OverviewProjection> {
  const { jobEvents, agentEvents } = await fetchAllDecoded();
  const allowlists = await loadDynamicAllowlists();
  const jobs =
    INDEXER_SCOPE === "arcnetwork"
      ? sdkProjectJobs(jobEvents)
      : sdkProjectJobs(jobEvents, buildJobFilter(allowlists.wallets));

  const jobWallets = collectJobWallets(jobs);
  const agents =
    INDEXER_SCOPE === "arcnetwork"
      ? sdkProjectAgents(agentEvents)
      : sdkProjectAgents(
          agentEvents,
          buildAgentFilter(allowlists.wallets, allowlists.agentIds, jobWallets),
        );

  const eventCount = jobEvents.length + agentEvents.length;
  return buildOverviewAggregation(jobs, agents, eventCount);
}

/**
 * Read proofs — Goldsky tables don't store proofs yet, return empty.
 */
export async function readGoldskyProofs(): Promise<never[]> {
  return [];
}
