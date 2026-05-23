const crypto = require("node:crypto");

const BASE_URL = (process.env.ARCLAYER_BASE_URL || "https://arclayers.xyz").replace(/\/$/, "");
const API_KEY = process.env.ARCLAYER_API_KEY || "";
const AGENT_ID = process.env.ARCLAYER_AGENT_ID || "llm-market-agent";
const DRY_RUN = process.env.DRY_RUN !== "false";
const CATEGORY = "prediction-market";

function sha256(payload) {
  return `0x${crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex")}`;
}

function currentSessionId() {
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000)) * 15 * 60;
  return `btc15m_${bucket}`;
}

async function getJson(route, options = {}) {
  const headers = { accept: "application/json" };
  if (options.authenticated) {
    if (!API_KEY) throw new Error("Missing ARCLAYER_API_KEY");
    headers.authorization = `Bearer ${API_KEY}`;
  }
  const res = await fetch(`${BASE_URL}${route}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`${route} failed: ${res.status} ${data.error || data.message || ""}`.trim());
  }
  return data;
}

async function latestSession() {
  if (!API_KEY) throw new Error("Missing ARCLAYER_API_KEY");
  const eventsData = await getJson(`/api/agent-bridge/events?limit=200&ts=${Date.now()}`, { authenticated: true });
  const events = (eventsData.events || []).filter((event) => {
    const aid = event.agent_id || event.agentId || (event.agent && event.agent.id);
    return aid === AGENT_ID;
  });

  const curId = currentSessionId();
  const preferredSessionId = events.some(e => (e.session_id || e.sessionId) === curId)
    ? curId
    : (events[0] ? (events[0].session_id || events[0].sessionId) : null);

  if (!preferredSessionId) return { ok: true, session: null };

  const sessionEvents = events.filter(e => (e.session_id || e.sessionId) === preferredSessionId).reverse();
  const receiptsData = await getJson(`/api/agent-bridge/receipts?sessionId=${encodeURIComponent(preferredSessionId)}&ts=${Date.now()}`, { authenticated: true });
  
  const roles = {};
  for (const event of sessionEvents) {
    const role = event.role || (event.type === "resolver_output" ? "analyzer" : (event.type === "evaluation" ? "evaluator" : null));
    if (!role) continue;
    const isRef = event.type === "receipt_reference";
    if (roles[role] && isRef) continue;
    roles[role] = event;
  }

  return {
    ok: true,
    session: {
      sessionId: preferredSessionId,
      roles,
      events: sessionEvents,
      receipts: receiptsData.receipts || []
    }
  };
}

async function postEvent({ sessionId, role, type, runtimeId, payload, metadata = {}, source = "external-llm-pm2-bot" }) {
  if (!API_KEY) throw new Error("Missing ARCLAYER_API_KEY");
  const body = {
    sessionId: sessionId || currentSessionId(),
    agentId: AGENT_ID,
    role,
    type,
    payload,
    payloadHash: sha256(payload),
    source,
    dryRun: true,
    category: CATEGORY,
    metadata: { ...metadata, autonomous: true, dryRunOnly: true }
  };
  const res = await fetch(`${BASE_URL}/api/agent-bridge/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`post event failed: ${res.status} ${data.error || ""}`);
  console.log(`[${role}] posted ${type} session=${body.sessionId} hash=${body.payloadHash.slice(0, 14)} event=${data.eventId}`);
  return { ...data, sessionId: body.sessionId, payloadHash: body.payloadHash };
}

async function postReceipt({ sessionId, payloadHash, metadata = {} }) {
  if (!API_KEY) throw new Error("Missing ARCLAYER_API_KEY");
  const body = {
    sessionId,
    receiptType: "dry_run",
    payloadHash,
    metadata: { ...metadata, autonomous: true, dryRunOnly: true }
  };
  const res = await fetch(`${BASE_URL}/api/agent-bridge/receipts`, {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`post receipt failed: ${res.status} ${data.error || ""}`);
  console.log(`[receipt] created session=${sessionId} receipt=${data.receiptId}`);
  return data;
}

module.exports = { BASE_URL, AGENT_ID, DRY_RUN, CATEGORY, sha256, currentSessionId, getJson, latestSession, postEvent, postReceipt };
