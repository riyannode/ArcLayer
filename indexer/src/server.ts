import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { DEFAULT_FROM_BLOCK, INDEXER_PORT, POLL_INTERVAL_MS } from "./config";
import { fetchAgentEvents, fetchJobEvents } from "./ingest";
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

type AutonomousFeedItem = {
  id: string;
  ts: string;
  agent: "Pythia" | "Hermes";
  type: "signal" | "payment" | "decision" | "trade" | "balance" | "error";
  label: string;
  detail: string;
  tx?: string;
};

function readLogLines(path: string, maxLines = 400) {
  try {
    return readFileSync(path, "utf8").trim().split("\n").slice(-maxLines);
  } catch {
    return [];
  }
}

function parseLogLine(line: string, agent: "Pythia" | "Hermes"): AutonomousFeedItem | null {
  const match = line.match(/^(\d+\|[^|]+\| )?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}):\s*(.*)$/);
  if (!match) return null;
  const ts = `${match[2].replace(" ", "T")}Z`;
  const msg = match[3];
  const tx = msg.match(/0x[a-fA-F0-9]{64}/)?.[0];
  let type: AutonomousFeedItem["type"] = "decision";
  let label = msg;

  if (msg.includes("Signal served")) {
    type = "signal";
    label = msg.replace(/^\[Pythia\]\s*/, "");
  } else if (msg.includes("Signal received")) {
    type = "signal";
    label = msg.replace(/^\[Hermes\]\s*/, "");
  } else if (msg.includes("Payment tx")) {
    type = "payment";
    label = "x402 signal payment settled";
  } else if (msg.includes("Ignia trade tx")) {
    type = "trade";
    label = "Ignia prediction trade executed";
  } else if (msg.includes("Executing YES") || msg.includes("Executing NO") || msg.includes("HOLD")) {
    type = "decision";
    label = msg.replace(/^\[Hermes\]\s*/, "");
  } else if (msg.includes("USDC balance") || msg.includes("Portfolio")) {
    type = "balance";
    label = msg.replace(/^\[Hermes\]\s*/, "");
  } else if (msg.includes("failed") || msg.includes("timeout") || msg.includes("error")) {
    type = "error";
    label = msg.replace(/^\[Hermes\]\s*/, "").replace(/^\[Pythia\]\s*/, "");
  } else if (!msg.includes("[Hermes]") && !msg.includes("[Pythia]")) {
    return null;
  }

  return {
    id: `${agent}-${ts}-${label.slice(0, 32)}`,
    ts,
    agent,
    type,
    label,
    detail: msg,
    tx,
  };
}

function readAutonomousFeed(limit = 50) {
  const pythia = readLogLines("/root/.pm2/logs/pythia-out.log")
    .map((line) => parseLogLine(line, "Pythia"))
    .filter(Boolean) as AutonomousFeedItem[];
  const hermes = readLogLines("/root/.pm2/logs/hermes-autonomous-out.log")
    .map((line) => parseLogLine(line, "Hermes"))
    .filter(Boolean) as AutonomousFeedItem[];
  const items = [...pythia, ...hermes]
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, Math.max(1, Math.min(limit, 100)));

  return {
    agents: {
      pythia: { role: "signal oracle", log: "/root/.pm2/logs/pythia-out.log" },
      hermes: { role: "autonomous trader", log: "/root/.pm2/logs/hermes-autonomous-out.log" },
    },
    items,
    latest: items[0]?.ts || null,
  };
}

async function runSyncCycle() {
  const fromBlockValue = readMetaValue("last_synced_block");
  const fromBlock = fromBlockValue ? BigInt(fromBlockValue) + BigInt(1) : DEFAULT_FROM_BLOCK;

  const [{ events, latestBlock }, { events: agentEvts }] = await Promise.all([
    fetchJobEvents(fromBlock),
    fetchAgentEvents(fromBlock),
  ]);

  if (events.length > 0 || agentEvts.length > 0) {
    await syncProjectionStore(events, agentEvts);
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

  if (url.pathname === "/autonomous-feed") {
    const limit = Number(url.searchParams.get("limit") || "50");
    const feed = readAutonomousFeed(limit);
    writeJson(res, feed);
    return;
  }

  writeJson(res, {
    ok: true,
    endpoints: ["/overview", "/jobs", "/jobs/:id", "/agents", "/agents/:id", "/proofs", "/job-events", "/agent-events", "/autonomous-feed"],
    eventCount: Number(readMetaValue("event_count") || "0"),
    lastSyncedBlock: readMetaValue("last_synced_block"),
  });
}).listen(INDEXER_PORT, () => {
  console.log(`ArcLayer indexer listening on http://localhost:${INDEXER_PORT}`);
});
