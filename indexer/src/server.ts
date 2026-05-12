import { createServer } from "node:http";
import { INDEXER_PORT, DEFAULT_FROM_BLOCK } from "./config";
import { fetchEscrowEvents } from "./ingest";
import { buildAgentProjection, buildJobProjection } from "./projections";

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const events = await fetchEscrowEvents(DEFAULT_FROM_BLOCK);

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (url.pathname === "/jobs") {
    res.end(JSON.stringify(buildJobProjection(events)));
    return;
  }

  if (url.pathname === "/agents") {
    res.end(JSON.stringify(buildAgentProjection(events)));
    return;
  }

  res.end(
    JSON.stringify({
      ok: true,
      endpoints: ["/jobs", "/agents"],
      eventCount: events.length,
    })
  );
}).listen(INDEXER_PORT, () => {
  console.log(`ArcWork indexer listening on http://localhost:${INDEXER_PORT}`);
});
