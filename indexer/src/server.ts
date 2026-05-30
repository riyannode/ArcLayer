import { createServer, type ServerResponse } from "node:http";
import {
  ARC_REFERENCE_AGENT_ID_FILTER,
  ARC_REFERENCE_METADATA_PREFIX_FILTER,
  ARC_REFERENCE_WALLET_FILTER,
  DEFAULT_FROM_BLOCK,
  IDENTITY_FROM_BLOCK,
  INDEXER_PORT,
  INDEX_ARC_REFERENCE_ERC8004,
  INDEX_ARC_REFERENCE_ERC8183,
  MAX_BLOCK_RANGE,
  POLL_INTERVAL_MS,
} from "./config";
import { fetchAgentEvents, fetchJobEvents, getLatestBlock } from "./ingest";
import { arcWalletFilterActive } from "./projections";
import { calculateToBlock } from "./sync-range";
import { getReferenceFilters, refreshReferenceFiltersFromSupabase } from "./reference-filters";
import {
  getLastA2AJobSyncError,
  readAgentById,
  readAgentEvents,
  readAgentProjectionDebug,
  readAgents,
  readCounts,
  readJobById,
  readJobEvents,
  readJobs,
  readMetaValue,
  readOverview,
  readOverviewSummary,
  readProofByJobId,
  readProofs,
  syncProjectionStore,
  writeMetaValue,
} from "./db";


if (
  process.env.NODE_ENV === "production" &&
  ARC_REFERENCE_WALLET_FILTER.length === 0 &&
  ARC_REFERENCE_AGENT_ID_FILTER.length === 0 &&
  ARC_REFERENCE_METADATA_PREFIX_FILTER.length === 0
) {
  throw new Error(
    "[indexer] At least one attribution filter must be set in production: ARC_REFERENCE_WALLET_FILTER, ARC_REFERENCE_AGENT_ID_FILTER, ARC_REFERENCE_METADATA_PREFIX_FILTER",
  );
}

// ─── Sync Lock ───────────────────────────────────────────────────────────────
let syncInProgress = false;
let lastSyncError: string | null = null;
let lastSyncAt: number | null = null;
let lastSyncDurationMs: number | null = null;
let syncSkipCount = 0;



function writeJson(res: ServerResponse, payload: unknown) {
  res.end(JSON.stringify(payload, null, 2));
}

function toPublicIndexerErrorMessage(error: string | null): string | null {
  return error ? "Indexer error (see server logs)" : null;
}

function toPublicReferenceFilters(filters: ReturnType<typeof getReferenceFilters>) {
  return {
    ...filters,
    lastRefreshError: toPublicIndexerErrorMessage(filters.lastRefreshError),
  };
}

export async function runSyncCycle() {
  if (syncInProgress) {
    syncSkipCount++;
    console.log(`[indexer] sync skip (previous still running) count=${syncSkipCount}`);
    return;
  }

  syncInProgress = true;
  const t0 = Date.now();

  try {
    const filters = await refreshReferenceFiltersFromSupabase();
    if (filters.lastRefreshError) {
      console.warn(`[indexer] reference filter refresh skipped: ${filters.lastRefreshError}`);
    }

    const fromBlockValue = readMetaValue("last_synced_block");
    const fromBlock = fromBlockValue ? BigInt(fromBlockValue) + BigInt(1) : DEFAULT_FROM_BLOCK;

    const agentFromBlockValue = readMetaValue("last_synced_agent_block");
    const agentFromBlock = agentFromBlockValue ? BigInt(agentFromBlockValue) + BigInt(1) : IDENTITY_FROM_BLOCK;

    const chainLatestBlock = await getLatestBlock();
    const toBlock = calculateToBlock(fromBlock, chainLatestBlock, MAX_BLOCK_RANGE);

    // Agent events use their own cursor but share the same toBlock ceiling.
    const agentToBlock = calculateToBlock(agentFromBlock, chainLatestBlock, MAX_BLOCK_RANGE);

    let events: Awaited<ReturnType<typeof fetchJobEvents>>["events"] = [];
    if (INDEX_ARC_REFERENCE_ERC8183) {
      events = (await fetchJobEvents(fromBlock, toBlock)).events;
    }

    let agentEvts: Awaited<ReturnType<typeof fetchAgentEvents>>["events"] = [];
    if (INDEX_ARC_REFERENCE_ERC8004) {
      agentEvts = (await fetchAgentEvents(agentFromBlock, agentToBlock)).events;
    }

    console.log(`[indexer] sync projection: jobs=${events.length} erc8004Agents=${agentEvts.length} block=${toBlock} agentBlock=${agentToBlock}`);
    const syncResult = await syncProjectionStore(events, agentEvts);

    // Advance cursors independently — only when feature flag is active
    if (INDEX_ARC_REFERENCE_ERC8183 && toBlock >= fromBlock) {
      writeMetaValue("last_synced_block", toBlock.toString());
    }
    if (INDEX_ARC_REFERENCE_ERC8004 && agentToBlock >= agentFromBlock) {
      writeMetaValue("last_synced_agent_block", agentToBlock.toString());
    }

    lastSyncError = syncResult.lastSyncError;
    lastSyncAt = Date.now();
    lastSyncDurationMs = Date.now() - t0;
  } catch (error) {
    lastSyncError = error instanceof Error ? error.message : String(error);
    console.error("[indexer] sync error:", lastSyncError);
  } finally {
    syncInProgress = false;
  }
}

async function startPollingLoop() {
  await runSyncCycle();
  setTimeout(startPollingLoop, POLL_INTERVAL_MS);
}

startPollingLoop();

createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (url.pathname === "/health") {
    const counts = readCounts();
    const filters = getReferenceFilters();
    writeJson(res, {
      ok: true,
      status: "ok",
      mode: "production",
      filterActive: arcWalletFilterActive(),
      storedAgentEventCount: counts.storedAgentEventCount,
      agentEventSourceBreakdown: counts.agentEventSourceBreakdown,
      rawImportedAgentEventCount: counts.rawImportedAgentEventCount,
      rawErc8004AgentEventCount: counts.rawErc8004AgentEventCount,
      projectedImportedAgentCount: counts.projectedImportedAgentCount,
      projectedErc8004AgentCount: counts.projectedErc8004AgentCount,
      projectedImportedAgentCountBeforeInsert: counts.projectedImportedAgentCountBeforeInsert,
      projectedErc8004AgentCountBeforeInsert: counts.projectedErc8004AgentCountBeforeInsert,
      filteredOutErc8004AgentCount: counts.filteredOutErc8004AgentCount,
      sampleFilteredErc8004Agents: counts.sampleFilteredErc8004Agents,
      storedJobEventCount: counts.storedJobEventCount,
      walletCount: filters.wallets.length,
      supabaseWallets: filters.supabaseWallets,
      supabaseAgentIds: filters.supabaseAgentIds,
      filterLastRefreshAt: filters.lastRefreshAt,
      filterLastRefreshError: toPublicIndexerErrorMessage(filters.lastRefreshError),
      importedAgentCount: counts.importedAgentCount,
      erc8004AgentCount: counts.erc8004AgentCount,
      erc8183JobCount: counts.erc8183JobCount,
      visibleAgentCount: counts.visibleAgentCount,
      totalAgentCount: counts.totalAgentCount,
      lastSyncedBlock: Number(readMetaValue("last_synced_block") || "0"),
      lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : (readMetaValue("last_sync_at") ? new Date(Number(readMetaValue("last_sync_at"))).toISOString() : null),
      lastSyncError: toPublicIndexerErrorMessage(lastSyncError ?? getLastA2AJobSyncError()),
    });
    return;
  }

  if (url.pathname === "/jobs") {
    writeJson(res, readJobs());
    return;
  }

  if (url.pathname.startsWith("/jobs/")) {
    const id = url.pathname.replace("/jobs/", "");
    if (!/^\d+$/.test(id)) {
      res.statusCode = 400;
      writeJson(res, { error: "Invalid job id." });
      return;
    }

    const job = readJobById(id);
    if (!job) {
      res.statusCode = 404;
      writeJson(res, { error: "Job not found." });
      return;
    }

    writeJson(res, {
      job,
      proof: readProofByJobId(id),
    });
    return;
  }

  if (url.pathname === "/agents") {
    const requestedSource = url.searchParams.get("source") || "all";
    const source = requestedSource === "imported" || requestedSource === "erc8004" ? requestedSource : "all";
    writeJson(res, readAgents(source));
    return;
  }

  if (url.pathname.startsWith("/agents/")) {
    const id = decodeURIComponent(url.pathname.replace("/agents/", ""));
    if (!id.trim()) {
      res.statusCode = 400;
      writeJson(res, { error: "Invalid agent id." });
      return;
    }

    const agent = readAgentById(id);
    if (!agent) {
      res.statusCode = 404;
      writeJson(res, { error: "Agent not found." });
      return;
    }

    writeJson(res, {
      agent,
      jobs: readJobs().filter((job) => job.provider === agent.controller || job.client === agent.controller),
      proofs: readProofs().filter((proof) => proof.agentId === id),
    });
    return;
  }

  if (url.pathname === "/proofs") {
    writeJson(res, readProofs());
    return;
  }

  if (url.pathname === "/job-events") {
    writeJson(res, readJobEvents());
    return;
  }

  if (url.pathname === "/agent-events") {
    writeJson(res, readAgentEvents());
    return;
  }

  if (url.pathname === "/overview/summary") {
    writeJson(res, readOverviewSummary());
    return;
  }

  if (url.pathname === "/overview") {
    writeJson(res, readOverview());
    return;
  }

  if (url.pathname === "/agent-debug") {
    const agentEvents = readAgentEvents();
    const projectionDebug = readAgentProjectionDebug();
    writeJson(res, {
      sources: readCounts().agentEventSourceBreakdown,
      sampleAgentEvents: agentEvents.slice(0, 5),
      referenceFilters: toPublicReferenceFilters(getReferenceFilters()),
      projectionDebug,
      rawErc8004AgentEventCount: projectionDebug.rawErc8004AgentEventCount,
      projectedErc8004AgentCount: projectionDebug.projectedErc8004AgentCountBeforeInsert,
      erc8004AgentCount: projectionDebug.projectedErc8004AgentCountBeforeInsert,
      totalAgentCount: readAgents().length,
      agentsCount: readAgents().length,
      lastSyncError: null,
    });
    return;
  }


  writeJson(res, {
    ok: true,
    mode: "arc-reference-100%",
    endpoints: ["/health", "/overview/summary", "/overview", "/jobs", "/jobs/:id", "/agents", "/agents/:id", "/proofs", "/job-events", "/agent-events", "/agent-debug"],
    eventCount: Number(readMetaValue("event_count") || "0"),
    lastSyncedBlock: readMetaValue("last_synced_block"),
    lastSyncedAgentBlock: readMetaValue("last_synced_agent_block"),
  });
}).listen(INDEXER_PORT, () => {
  console.log(`ArcLayer indexer (Arc Reference Mode) listening on http://localhost:${INDEXER_PORT}`);
});