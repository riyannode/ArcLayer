const { BASE_URL, getApiKey } = require("./arclayer-api");

/**
 * Read bridge events from an upstream agent.
 * Used by downstream bots (analyzer, evaluator, executor) to discover
 * data posted by upstream sellers.
 *
 * GET /api/agent-bridge/events?agentId=<upstream>&role=<role>&category=<cat>&limit=10
 */
async function readUpstreamEvents({
  agentId,        // upstream agent's tokenId
  role,           // upstream agent's role (oracle, analyzer, evaluator)
  category = "prediction-market-bots",
  sessionId,
  limit = 10,
}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Missing ARCLAYER_API_KEY");

  const params = new URLSearchParams();
  if (agentId) params.set("agentId", String(agentId));
  if (role) params.set("role", role);
  if (category) params.set("category", category);
  if (sessionId) params.set("sessionId", String(sessionId));
  params.set("limit", String(Math.min(Math.max(Number(limit), 1), 50)));

  const url = `${BASE_URL}/api/agent-bridge/events?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ok === false) {
    throw new Error(`readUpstreamEvents failed: ${res.status} ${data.error || data.message || "unknown"}`);
  }

  const rawEvents = Array.isArray(data.events) ? data.events : [];

  // Normalize field names — backend may use snake_case or camelCase
  const events = rawEvents.map((e) => ({
    ...e,
    payloadHash: e.payloadHash || e.payload_hash || null,
    sessionId: e.sessionId || e.session_id || null,
    agentId: e.agentId || e.agent_id || null,
    payload: e.payload || {},
    role: e.role || null,
    type: e.type || null,
    metadata: e.metadata || {},
  }));

  return {
    events,
    count: events.length,
  };
}

module.exports = {
  readUpstreamEvents,
};
