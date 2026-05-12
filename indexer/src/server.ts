import { createServer } from "node:http";
import { INDEXER_PORT, DEFAULT_FROM_BLOCK } from "./config";
import { fetchJobEvents } from "./ingest";
import {
  readAgentById,
  readAgentEvents,
  readAgents,
  readJobById,
  readJobEvents,
  readJobs,
  readOverview,
  readProofByJobId,
  readProofs,
  syncProjectionStore,
} from "./db";

function writeJson(res: Parameters<typeof createServer>[0] extends (req: infer _Req, res: infer Res) => unknown ? Res : never, payload: unknown) {
  res.end(JSON.stringify(payload, null, 2));
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const events = await fetchJobEvents(DEFAULT_FROM_BLOCK);
  await syncProjectionStore(events);

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
      eventCount: events.length,
    });
}).listen(INDEXER_PORT, () => {
  console.log(`ArcLayer indexer listening on http://localhost:${INDEXER_PORT}`);
});
