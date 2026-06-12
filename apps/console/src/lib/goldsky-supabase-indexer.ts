/**
 * Goldsky → Supabase Postgres reader skeleton.
 *
 * Reads raw event tables written by Goldsky Turbo/Mirror pipelines and maps
 * them into shared SDK projection helpers from @arclayer/sdk.
 *
 * SERVER-ONLY — uses Supabase service_role key. NEVER import from client
 * components or pages with 'use client'.
 *
 * Raw table schema: see goldsky/arclayer-events.draft.yaml
 *   - goldsky_erc8183_events_raw: block_number, block_timestamp, transaction_hash,
 *     log_index, event_name, client, provider, evaluator, job_id, amount,
 *     expired_at, description, hook, deliverable, reason, rejector
 *   - goldsky_erc8004_identity_events_raw: block_number, block_timestamp,
 *     transaction_hash, log_index, event_name, from_address, to_address, token_id
 *   - goldsky_erc8004_reputation_events_raw: block_number, block_timestamp,
 *     transaction_hash, log_index, event_name, agent_id, client_address,
 *     feedback_index, value, value_decimals, tag1, tag2, endpoint,
 *     feedback_uri, feedback_hash
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
  // SDK pure projection helpers:
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

// ── Raw row types (Goldsky schema from arclayer-events.draft.yaml) ──────────

/** Raw ERC-8183 job event row. */
type RawJobEventRow = {
  event_name: string;
  block_number: string | number;
  transaction_hash: string;
  log_index: number;
  job_id: string | number | null;
  client: string | null;
  provider: string | null;
  evaluator: string | null;
  hook: string | null;
  expired_at: string | number | null;
  description: string | null;
  amount: string | number | null;
  deliverable: string | null;
  reason: string | null;
  rejector: string | null;
};

/**
 * Raw ERC-8004 identity event row.
 * Goldsky emits Transfer events with from_address, to_address, token_id.
 * Registration = from_address is zero address.
 * Supports both token_id (Goldsky native) and agent_id (if pipeline adds it).
 */
type RawAgentEventRow = {
  event_name: string;
  block_number: string | number;
  transaction_hash: string;
  log_index: number;
  /** Goldsky native column for ERC-721 Transfer. */
  token_id: string | number | null;
  /** Alias some pipelines may add. Used as fallback. */
  agent_id: string | number | null;
  /** Transfer.from — zero address for registrations. */
  from_address: string | null;
  /** Transfer.to — the controller/recipient. */
  to_address: string | null;
  /** Optional: enriched by pipeline or join. */
  controller: string | null;
  metadata_uri: string | null;
  skill_hash: string | null;
  source: string | null;
  chain_id: number | null;
  registry_address: string | null;
  contract_address: string | null;
};

// ── Pagination helper ──────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Fetch all rows from a Goldsky raw table using cursor pagination.
 * Uses block_number + log_index as cursor to avoid offset overhead.
 */
async function fetchAllPages<T extends { block_number: string | number; log_index: number }>(
  table: string,
  columns: string,
): Promise<T[]> {
  const supabase = getSupabaseAdmin();
  const allRows: T[] = [];
  let lastBlock = 0;
  let lastLogIndex = -1;

  // Paginate using (block_number, log_index) cursor
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = supabase
      .schema(GOLDSKY_SCHEMA)
      .from(table)
      .select(columns)
      .order("block_number", { ascending: true })
      .order("log_index", { ascending: true })
      .limit(PAGE_SIZE);

    // Apply cursor after first page
    if (allRows.length > 0) {
      query = query.or(
        `block_number.gt.${lastBlock},and(block_number.eq.${lastBlock},log_index.gt.${lastLogIndex})`,
      );
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`[goldsky-reader] fetchAllPages(${table}): ${error.message}`);
    }

    const rows = (data ?? []) as unknown as T[];
    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) break; // last page

    // Advance cursor
    const last = rows[rows.length - 1];
    lastBlock = Number(last.block_number);
    lastLogIndex = Number(last.log_index);
  }

  return allRows;
}

// ── Normalizers (raw rows → SDK types) ─────────────────────────────────────

function normalizeJobEvent(row: RawJobEventRow): IndexedJobEvent {
  return {
    eventName: row.event_name as IndexedJobEvent["eventName"],
    blockNumber: BigInt(row.block_number),
    transactionHash: row.transaction_hash as `0x${string}`,
    logIndex: Number(row.log_index),
    jobId: row.job_id != null ? BigInt(row.job_id) : undefined,
    client: row.client as any,
    provider: row.provider as any,
    evaluator: row.evaluator as any,
    hook: row.hook as any,
    expiredAt: row.expired_at != null ? BigInt(row.expired_at) : undefined,
    description: row.description ?? undefined,
    amount: row.amount != null ? BigInt(row.amount) : undefined,
    deliverable: row.deliverable as any,
    reason: row.reason as any,
    rejector: row.rejector as any,
  };
}

/**
 * Normalize a Goldsky identity row to an SDK agent event.
 *
 * ERC-8004 registration = Transfer event where from_address is the zero address.
 * The token_id (or agent_id) is the ERC-721 token = agent ID.
 * Controller = to_address (the recipient of the mint).
 */
function normalizeAgentEvent(row: RawAgentEventRow): IndexedAgentEvent {
  const agentId = row.token_id ?? row.agent_id;
  const controller = row.controller ?? row.to_address ?? ZERO_ADDRESS;

  return {
    eventName: row.event_name as IndexedAgentEvent["eventName"],
    blockNumber: BigInt(row.block_number),
    transactionHash: row.transaction_hash as `0x${string}`,
    logIndex: Number(row.log_index),
    agentId: agentId != null ? BigInt(agentId) : 0n,
    controller: controller as any,
    metadataURI: row.metadata_uri ?? undefined,
    skillHash: row.skill_hash as any,
    source: row.source ?? undefined,
    chainId: row.chain_id ?? undefined,
    registryAddress: row.registry_address as any,
    contractAddress: row.contract_address as any,
  };
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

// ── Supabase query helpers ─────────────────────────────────────────────────

async function fetchRawJobEvents(): Promise<RawJobEventRow[]> {
  return fetchAllPages<RawJobEventRow>(
    TABLES.erc8183,
    "event_name,block_number,transaction_hash,log_index,job_id,client,provider,evaluator,hook,expired_at,description,amount,deliverable,reason,rejector",
  );
}

/**
 * Fetch raw identity events. Filters to registration transfers only
 * (from_address = zero address) to avoid ownership transfers/burns
 * corrupting the projected controller during SDK deduplication.
 */
async function fetchRawAgentEvents(): Promise<RawAgentEventRow[]> {
  const supabase = getSupabaseAdmin();
  const allRows: RawAgentEventRow[] = [];
  let lastBlock = 0;
  let lastLogIndex = -1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = supabase
      .schema(GOLDSKY_SCHEMA)
      .from(TABLES.erc8004Identity)
      .select("event_name,block_number,transaction_hash,log_index,token_id,agent_id,from_address,to_address,controller,metadata_uri,skill_hash,source,chain_id,registry_address,contract_address")
      .eq("from_address", ZERO_ADDRESS)
      .order("block_number", { ascending: true })
      .order("log_index", { ascending: true })
      .limit(PAGE_SIZE);

    if (allRows.length > 0) {
      query = query.or(
        `block_number.gt.${lastBlock},and(block_number.eq.${lastBlock},log_index.gt.${lastLogIndex})`,
      );
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`[goldsky-reader] fetchRawAgentEvents: ${error.message}`);
    }

    const rows = (data ?? []) as unknown as RawAgentEventRow[];
    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) break;

    const last = rows[rows.length - 1];
    lastBlock = Number(last.block_number);
    lastLogIndex = Number(last.log_index);
  }

  return allRows;
}

// ── Public reader functions ────────────────────────────────────────────────

/**
 * Health check — verifies Supabase connection and raw table accessibility.
 *
 * ok = true when:
 * - Supabase client initializes successfully
 * - All required tables (erc8183, erc8004Identity) are accessible
 * - In arclayer scope: at least one attribution source is active
 *   (env allowlists OR dynamic Supabase allowlists OR metadata prefixes)
 */
export async function readGoldskyHealth(): Promise<{
  ok: boolean;
  scope: IndexerScope;
  walletFilterActive: boolean;
  agentIdFilterActive: boolean;
  metadataPrefixes: string[];
  tables: Record<string, boolean>;
  dynamicAllowlists?: { wallets: number; agentIds: number };
  error?: string;
}> {
  // Catch Supabase client initialization failures
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
      error: `Supabase client init failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const tableChecks: Record<string, boolean> = {};

  // Probe block_number (exists in all Goldsky raw tables) instead of id
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

  // Load dynamic allowlists for health reporting
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

  // In arclayer scope, at least one attribution source must be active
  // to prevent exposing global shared-contract activity as ArcLayer data.
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
    dynamicAllowlists,
    ...((allRequiredOk && gateConfigured) ? {} : {
      error: !allRequiredOk
        ? "One or more required raw tables not accessible"
        : "ArcLayer scope requires at least one attribution source (wallet filter, agent ID filter, or metadata prefix)",
    }),
  };
}

/** Read all projected jobs from Goldsky raw tables. */
export async function readGoldskyJobs(): Promise<ProjectedJob[]> {
  const allowlists = await loadDynamicAllowlists();
  const rawEvents = await fetchRawJobEvents();
  const events = rawEvents.map(normalizeJobEvent);

  if (INDEXER_SCOPE === "arcnetwork") {
    return sdkProjectJobs(events);
  }

  return sdkProjectJobs(events, buildJobFilter(allowlists.wallets));
}

/** Read a single job detail by jobId. */
export async function readGoldskyJobDetail(
  jobId: string,
): Promise<{ job: ProjectedJob; proof: null } | null> {
  const allowlists = await loadDynamicAllowlists();
  const rawEvents = await fetchRawJobEvents();
  const events = rawEvents.map(normalizeJobEvent);

  const filter = INDEXER_SCOPE === "arcnetwork" ? undefined : buildJobFilter(allowlists.wallets);
  const jobs = sdkProjectJobs(events, filter);
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;
  return { job, proof: null };
}

/** Read all projected agents from Goldsky raw tables. */
export async function readGoldskyAgents(): Promise<ProjectedAgent[]> {
  const allowlists = await loadDynamicAllowlists();
  const rawJobEvents = await fetchRawJobEvents();
  const rawAgentEvents = await fetchRawAgentEvents();
  const jobEvents = rawJobEvents.map(normalizeJobEvent);
  const agentEvents = rawAgentEvents.map(normalizeAgentEvent);

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

/** Read a single agent detail by agentId. */
export async function readGoldskyAgentDetail(
  agentId: string,
): Promise<{ agent: ProjectedAgent; jobs: ProjectedJob[]; proofs: [] } | null> {
  const allowlists = await loadDynamicAllowlists();
  const rawJobEvents = await fetchRawJobEvents();
  const rawAgentEvents = await fetchRawAgentEvents();
  const jobEvents = rawJobEvents.map(normalizeJobEvent);
  const agentEvents = rawAgentEvents.map(normalizeAgentEvent);

  const jFilter = INDEXER_SCOPE === "arcnetwork" ? undefined : buildJobFilter(allowlists.wallets);
  const jobs = sdkProjectJobs(jobEvents, jFilter);
  const jobWallets = collectJobWallets(jobs);

  const aFilterFn = INDEXER_SCOPE === "arcnetwork"
    ? undefined
    : buildAgentFilter(allowlists.wallets, allowlists.agentIds, jobWallets);
  const agents = sdkProjectAgents(agentEvents, aFilterFn);

  const agent = agents.find((a) => a.agentId === agentId);
  if (!agent) return null;

  const agentCtrl = agent.controller.toLowerCase();
  const agentJobs = jobs.filter(
    (job) =>
      job.provider?.toLowerCase() === agentCtrl ||
      job.client?.toLowerCase() === agentCtrl ||
      job.evaluator?.toLowerCase() === agentCtrl,
  );

  return { agent, jobs: agentJobs, proofs: [] };
}

/** Read overview aggregation from Goldsky raw tables. */
export async function readGoldskyOverview(): Promise<OverviewProjection> {
  const allowlists = await loadDynamicAllowlists();
  const rawJobEvents = await fetchRawJobEvents();
  const rawAgentEvents = await fetchRawAgentEvents();
  const jobEvents = rawJobEvents.map(normalizeJobEvent);
  const agentEvents = rawAgentEvents.map(normalizeAgentEvent);

  const jFilter = INDEXER_SCOPE === "arcnetwork" ? undefined : buildJobFilter(allowlists.wallets);
  const jobs = sdkProjectJobs(jobEvents, jFilter);
  const jobWallets = collectJobWallets(jobs);

  const aFilterFn = INDEXER_SCOPE === "arcnetwork"
    ? undefined
    : buildAgentFilter(allowlists.wallets, allowlists.agentIds, jobWallets);
  const agents = sdkProjectAgents(agentEvents, aFilterFn);

  return buildOverviewAggregation(jobs, agents, jobEvents.length + agentEvents.length);
}

/** Read proofs — ERC-8183 reference flow does not mint custom WorkProof NFTs. */
export async function readGoldskyProofs(): Promise<[]> {
  return [];
}
