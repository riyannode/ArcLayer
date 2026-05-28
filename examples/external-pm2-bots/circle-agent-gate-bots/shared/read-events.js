const { getApiKey } = require("./arclayer-api");

const BASE_URL = (process.env.ARCLAYER_BASE_URL || "https://arclayers.xyz").replace(/\/$/, "");

/**
 * Normalize Supabase snake_case fields to camelCase for consistent access.
 * Also extracts payloadHash from both top-level and nested payload.
 */
function normalizeEvent(raw) {
  return {
    id: raw.id,
    sessionId: raw.session_id || raw.sessionId || null,
    agentId: raw.agent_id || raw.agentId || null,
    role: raw.role || null,
    type: raw.type || raw.event_type || null,
    payloadHash: raw.payload_hash || raw.payloadHash || (raw.payload?.payloadHash) || null,
    payload: raw.payload || {},
    metadata: raw.metadata || {},
    createdAt: raw.created_at || raw.createdAt || null,
  };
}

/**
 * Read bridge events from upstream agent.
 * Calls GET /api/agent-bridge/events?agentId=X&role=Y&category=Z
 */
async function readUpstreamEvents({
  agentId,
  role,
  category,
  sessionId,
  limit = 3,
  filterType = null, // e.g. "market_snapshot" untuk oracle, exclude receipt_reference
}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Missing ARCLAYER_API_KEY for readUpstreamEvents");
  if (!agentId) throw new Error("Missing agentId for readUpstreamEvents");

  const params = new URLSearchParams();
  params.set("agentId", agentId);
  params.set("limit", String(Math.min(Math.max(1, limit * 3), 50))); // fetch more to filter
  if (role) params.set("role", role);
  if (category) params.set("category", category);
  if (sessionId) params.set("sessionId", sessionId);

  const url = `${BASE_URL}/api/agent-bridge/events?${params.toString()}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ok === false) {
    throw new Error(
      `readUpstreamEvents failed: ${res.status} ${data.error || data.message || "unknown"}`
    );
  }

  let events = (Array.isArray(data.events) ? data.events : []).map(normalizeEvent);

  // Filter out receipt_reference — we want actual data events
  events = events.filter((e) => e.type !== "receipt_reference");

  // Filter by specific event type if requested
  if (filterType) {
    events = events.filter((e) => e.type === filterType);
  }

  // Return only the requested limit
  events = events.slice(0, limit);

  return {
    events,
    total: events.length,
  };
}

module.exports = {
  readUpstreamEvents,
};
