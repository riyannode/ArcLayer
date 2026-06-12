/**
 * Goldsky → Supabase Postgres reader skeleton.
 *
 * Reads raw event tables written by Goldsky Turbo/Mirror pipelines and maps
 * them into shared SDK projection helpers from @arclayer/sdk.
 *
 * SERVER-ONLY — uses Supabase service_role key. NEVER import from client
 * components or pages with 'use client'.
 *
 * Raw table schema assumptions (documented below). If Goldsky writes with
 * different column names, add narrow normalization adapters.
 *
 * @module apps/console/src/lib/goldsky-supabase-indexer
 */

import {
  type IndexedJobEvent,
  type IndexedAgentEvent,
  // SDK pure projection helpers:
  projectJobsFromEvents as sdkProjectJobs,
  projectAgentsFromEvents as sdkProjectAgents,
  buildOverviewAggregation,
  collectJobWallets,
  sourceForAgentEvent,
  isImportedArcLayerAgent,
  matchesMetadataPrefix,
  type ProjectedJob,
  type ProjectedAgent,
  type OverviewProjection,
} from "@arclayer/sdk";
import { getSupabaseAdmin } from "@/lib/x402/supabaseClient";

// ── Env config (server-only, mirrors indexer/src/config.ts pattern) ─────────

type IndexerScope = "arclayer" | "arcnetwork";

const INDEXER_SCOPE: IndexerScope =
  process.env.INDEXER_SCOPE === "arcnetwork" ? "arcnetwork" : "arclayer";

const WALLET_FILTER: string[] = (process.env.ARC_REFERENCE_WALLET_FILTER || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s.startsWith("0x") && s.length === 42);

const AGENT_ID_FILTER: string[] = (
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

// ── Raw table names ────────────────────────────────────────────────────────

const TABLES = {
  erc8183: "goldsky_erc8183_events_raw",
  erc8004Identity: "goldsky_erc8004_identity_events_raw",
  erc8004Reputation: "goldsky_erc8004_reputation_events_raw",
} as const;

// ── Raw row types (what Goldsky writes into Supabase) ──────────────────────
// These are typed adapters with narrow normalization.
// If Goldsky schema differs, adjust the normalizers only.

/** Raw ERC-8183 job event row from Goldsky Turbo/Mirror. */
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
  // Metadata
  chain_id: number | null;
  contract_address: string | null;
};

/** Raw ERC-8004 identity event row from Goldsky Turbo/Mirror. */
type RawAgentEventRow = {
  event_name: string;
  block_number: string | number;
  transaction_hash: string;
  log_index: number;
  agent_id: string | number | null;
  controller: string | null;
  metadata_uri: string | null;
  skill_hash: string | null;
  from_address: string | null;
  to_address: string | null;
  // Metadata
  source: string | null;
  chain_id: number | null;
  registry_address: string | null;
  contract_address: string | null;
};

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

function normalizeAgentEvent(row: RawAgentEventRow): IndexedAgentEvent {
  return {
    eventName: row.event_name as IndexedAgentEvent["eventName"],
    blockNumber: BigInt(row.block_number),
    transactionHash: row.transaction_hash as `0x${string}`,
    logIndex: Number(row.log_index),
    agentId: row.agent_id != null ? BigInt(row.agent_id) : 0n,
    controller: (row.controller ?? row.to_address ?? "0x0000000000000000000000000000000000000000") as any,
    metadataURI: row.metadata_uri ?? undefined,
    skillHash: row.skill_hash as any,
    source: row.source ?? undefined,
    chainId: row.chain_id ?? undefined,
    registryAddress: row.registry_address as any,
    contractAddress: row.contract_address as any,
  };
}

// ── Scope gating (mirrors indexer/src/reference-filters.ts logic) ──────────

function walletFilterActive(): boolean {
  return WALLET_FILTER.length > 0;
}

function agentIdFilterActive(): boolean {
  return AGENT_ID_FILTER.length > 0;
}

function matchesWallet(addr: unknown): boolean {
  if (INDEXER_SCOPE === "arcnetwork") return true;
  if (!walletFilterActive()) return true;
  if (typeof addr !== "string") return false;
  return WALLET_FILTER.includes(addr.toLowerCase());
}

function agentIdCandidates(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const id = String(value).trim().toLowerCase();
  if (!id) return [];
  const raw = id.includes(":") ? id.split(":").pop() || id : id;
  return Array.from(new Set([raw, id, `erc8004_identity_registry:${raw}`, `imported_arclayer_registry:${raw}`]));
}

function matchesAgentId(agentId: unknown): boolean {
  if (INDEXER_SCOPE === "arcnetwork") return true;
  if (!agentIdFilterActive()) return true;
  const candidates = agentIdCandidates(agentId);
  return candidates.some((id) => AGENT_ID_FILTER.includes(id));
}

/** Job filter callback for arclayer scope. */
function jobFilter(created: IndexedJobEvent | undefined): boolean {
  return (
    matchesWallet(created?.client) ||
    matchesWallet(created?.provider) ||
    matchesWallet(created?.evaluator)
  );
}

/** Agent filter callback for arclayer scope. */
function agentFilter(
  event: IndexedAgentEvent,
  arcJobWallets?: Set<string>,
): boolean {
  if (isImportedArcLayerAgent(event)) return true;
  if (INDEXER_SCOPE === "arcnetwork") return true;
  if (!walletFilterActive()) return true;

  const ctrl = (event.controller ?? "").toLowerCase();
  const uri = event.metadataURI ?? "";
  const rawAgentId = String(event.agentId);
  const source = sourceForAgentEvent(event);
  const sourceAgentId = `${source}:${rawAgentId}`;

  if (matchesWallet(ctrl)) return true;
  if (arcJobWallets?.has(ctrl)) return true;
  if (matchesAgentId(rawAgentId) || matchesAgentId(sourceAgentId)) return true;
  if (matchesMetadataPrefix(uri, METADATA_PREFIX_FILTER)) return true;
  return false;
}

// ── Supabase query helpers ─────────────────────────────────────────────────

async function fetchRawJobEvents(): Promise<RawJobEventRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLES.erc8183)
    .select("*")
    .order("block_number", { ascending: true })
    .order("log_index", { ascending: true })
    .limit(50000);

  if (error) {
    throw new Error(`[goldsky-reader] fetchRawJobEvents: ${error.message}`);
  }
  return (data ?? []) as RawJobEventRow[];
}

async function fetchRawAgentEvents(): Promise<RawAgentEventRow[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(TABLES.erc8004Identity)
    .select("*")
    .order("block_number", { ascending: true })
    .order("log_index", { ascending: true })
    .limit(50000);

  if (error) {
    throw new Error(`[goldsky-reader] fetchRawAgentEvents: ${error.message}`);
  }
  return (data ?? []) as RawAgentEventRow[];
}

// ── Public reader functions ────────────────────────────────────────────────

/** Health check — verifies Supabase connection and raw table accessibility. */
export async function readGoldskyHealth(): Promise<{
  ok: boolean;
  scope: IndexerScope;
  walletFilterActive: boolean;
  agentIdFilterActive: boolean;
  metadataPrefixes: string[];
  tables: Record<string, boolean>;
  error?: string;
}> {
  const supabase = getSupabaseAdmin();
  const tableChecks: Record<string, boolean> = {};

  for (const [key, table] of Object.entries(TABLES)) {
    try {
      const { error } = await supabase.from(table).select("id").limit(1);
      tableChecks[key] = !error;
    } catch {
      tableChecks[key] = false;
    }
  }

  const allTablesOk = Object.values(tableChecks).every(Boolean);

  return {
    ok: allTablesOk,
    scope: INDEXER_SCOPE,
    walletFilterActive: walletFilterActive(),
    agentIdFilterActive: agentIdFilterActive(),
    metadataPrefixes: METADATA_PREFIX_FILTER,
    tables: tableChecks,
    ...(allTablesOk ? {} : { error: "One or more raw tables not accessible" }),
  };
}

/** Read all projected jobs from Goldsky raw tables. */
export async function readGoldskyJobs(): Promise<ProjectedJob[]> {
  const rawEvents = await fetchRawJobEvents();
  const events = rawEvents.map(normalizeJobEvent);
  return sdkProjectJobs(events, jobFilter);
}

/** Read a single job detail by jobId. */
export async function readGoldskyJobDetail(
  jobId: string,
): Promise<{ job: ProjectedJob; proof: null } | null> {
  const rawEvents = await fetchRawJobEvents();
  const events = rawEvents.map(normalizeJobEvent);
  const jobs = sdkProjectJobs(events, jobFilter);
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;
  return { job, proof: null };
}

/** Read all projected agents from Goldsky raw tables. */
export async function readGoldskyAgents(): Promise<ProjectedAgent[]> {
  const rawJobEvents = await fetchRawJobEvents();
  const rawAgentEvents = await fetchRawAgentEvents();
  const jobEvents = rawJobEvents.map(normalizeJobEvent);
  const agentEvents = rawAgentEvents.map(normalizeAgentEvent);

  // Build job wallets for cross-referencing agents in arclayer jobs
  const jobs = sdkProjectJobs(jobEvents, jobFilter);
  const jobWallets = collectJobWallets(jobs);

  return sdkProjectAgents(agentEvents, (event) =>
    agentFilter(event, jobWallets),
  );
}

/** Read a single agent detail by agentId. */
export async function readGoldskyAgentDetail(
  agentId: string,
): Promise<{ agent: ProjectedAgent; jobs: ProjectedJob[]; proofs: [] } | null> {
  const rawJobEvents = await fetchRawJobEvents();
  const rawAgentEvents = await fetchRawAgentEvents();
  const jobEvents = rawJobEvents.map(normalizeJobEvent);
  const agentEvents = rawAgentEvents.map(normalizeAgentEvent);

  const jobs = sdkProjectJobs(jobEvents, jobFilter);
  const jobWallets = collectJobWallets(jobs);
  const agents = sdkProjectAgents(agentEvents, (event) =>
    agentFilter(event, jobWallets),
  );

  const agent = agents.find((a) => a.agentId === agentId);
  if (!agent) return null;

  const agentJobs = jobs.filter(
    (job) =>
      job.provider?.toLowerCase() === agent.controller.toLowerCase() ||
      job.client?.toLowerCase() === agent.controller.toLowerCase(),
  );

  return { agent, jobs: agentJobs, proofs: [] };
}

/** Read overview aggregation from Goldsky raw tables. */
export async function readGoldskyOverview(): Promise<OverviewProjection> {
  const rawJobEvents = await fetchRawJobEvents();
  const rawAgentEvents = await fetchRawAgentEvents();
  const jobEvents = rawJobEvents.map(normalizeJobEvent);
  const agentEvents = rawAgentEvents.map(normalizeAgentEvent);

  const jobs = sdkProjectJobs(jobEvents, jobFilter);
  const agents = sdkProjectAgents(agentEvents, (event) =>
    agentFilter(event, collectJobWallets(jobs)),
  );

  return buildOverviewAggregation(jobs, agents, jobEvents.length + agentEvents.length);
}

/** Read proofs — ERC-8183 reference flow does not mint custom WorkProof NFTs. */
export async function readGoldskyProofs(): Promise<[]> {
  return [];
}
