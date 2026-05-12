import { createServer, type ServerResponse } from "node:http";
import { DEFAULT_FROM_BLOCK, INDEXER_PORT, POLL_INTERVAL_MS } from "./config";
import { fetchJobEvents } from "./ingest";
import {
  readAgentById,
  readAgentEvents,
  readAgents,
  readJobById,
  readJobEvents,
  readJobs,
  readMetaValue,
  readOverview,
  readProofByJobId,
  readProofs,
  syncProjectionStore,
  writeMetaValue,
} from "./db";

function writeJson(res: ServerResponse, payload: unknown) {
  res.end(JSON.stringify(payload, null, 2));
}

async function runSyncCycle() {
  const fromBlockValue = readMetaValue("last_synced_block");
  const fromBlock = fromBlockValue ? BigInt(fromBlockValue) + BigInt(1) : DEFAULT_FROM_BLOCK;
  const { events, latestBlock } = await fetchJobEvents(fromBlock);

  if (events.length > 0) {
    await syncProjectionStore(events);
  }

  // Always advance the cursor to latestBlock so empty ranges don't
  // get re-scanned forever. Previous logic returned early on zero events
  // which pinned fromBlock and produced an ever-growing re-scan window.
  if (latestBlock >= fromBlock) {
    writeMetaValue("last_synced_block", latestBlock.toString());
  }
}

async function startPollingLoop() {
  try {
    await runSyncCycle();
  } catch (error) {
    console.error("Indexer polling error", error);
  } finally {
    setTimeout(startPollingLoop, POLL_INTERVAL_MS);
  }
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
    writeJson(res, readAgents());
    return;
  }

  if (url.pathname.startsWith("/agents/")) {
    const id = url.pathname.replace("/agents/", "");
    if (!/^\d+$/.test(id)) {
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
      jobs: readJobs().filter((job) => job.agentId === id),
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

  if (url.pathname === "/overview") {
    writeJson(res, readOverview());
    return;
  }

  writeJson(res, {
    ok: true,
    endpoints: ["/overview", "/jobs", "/jobs/:id", "/agents", "/agents/:id", "/proofs", "/job-events", "/agent-events"],
    eventCount: Number(readMetaValue("event_count") || "0"),
    lastSyncedBlock: readMetaValue("last_synced_block"),
  });
}).listen(INDEXER_PORT, () => {
  console.log(`ArcLayer indexer listening on http://localhost:${INDEXER_PORT}`);
});
