const crypto = require("node:crypto");

const BASE_URL = (process.env.ARCLAYER_BASE_URL || "https://arclayers.xyz").replace(/\/$/, "");
const API_KEY = process.env.ARCLAYER_API_KEY || "";
const A2A_LIVE_EVENTS_TOKEN = process.env.A2A_LIVE_EVENTS_TOKEN || "";
const AGENT_ID = process.env.ARCLAYER_AGENT_ID || "llm-market-agent";

function sha256(payload) { return `0x${crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex")}`; }
function currentSessionId() { const bucket = Math.floor(Date.now() / (15 * 60 * 1000)) * 15 * 60; return `btc15m_${bucket}`; }

function isValidTxHash(value) { return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value); }

function buildRoleState(events) {
  const roles = {};
  for (const event of events) {
    const role = (event.role || '').toString();
    if (!role) continue;
    roles[role] = { payload: event.payload || {}, type: event.type || event.eventType || null, eventId: event.id || event.eventId || null };
  }
  return roles;
}

function hasExecutorX402Proof({ sessionId, events, receipts, liveEvents }) {
  const eventProofs = (events || []).filter((e) => {
    const p = e.payload || {};
    const tx = p.txHash || p.transaction || e.txHash || e.transaction;
    return (e.role || '').toString().toLowerCase() === 'executor' &&
      (e.type || e.eventType || '').toString().toLowerCase() === 'receipt_reference' &&
      (e.session_id || e.sessionId || '').toString() === sessionId &&
      (p.scope || '').toString() === 'external_trace' &&
      (p.source || e.source || '').toString() === 'x402-autopay' &&
      isValidTxHash(tx);
  });
  if (!eventProofs.length) return false;
  const txSet = new Set(eventProofs.map((e) => ((e.payload || {}).txHash || (e.payload || {}).transaction || e.txHash || e.transaction).toLowerCase()));
  const receiptProof = (receipts || []).some((r) => {
    const type = (r.receipt_type || r.receiptType || '').toString().toLowerCase();
    const m = r.metadata || {};
    const tx = (m.txHash || r.transaction || r.tx_hash || '').toString().toLowerCase();
    return (type === 'x402_payment_proof' || type === 'x402_arc_native') && m.role === 'executor' && m.scope === 'external_trace' && m.source === 'x402-autopay' && txSet.has(tx);
  });
  if (receiptProof) return true;
  return (liveEvents || []).some((e) => {
    const m = e.metadata || {};
    const sid = (m.sessionId || '').toString();
    const tx = (e.txHash || m.txHash || '').toString().toLowerCase();
    return (e.eventType || '').toString() === 'x402_paid' && sid === sessionId && txSet.has(tx);
  });
}
async function getJson(route, options = {}) { const headers = { accept: "application/json" }; if (options.authenticated) headers.authorization = `Bearer ${API_KEY}`; const res = await fetch(`${BASE_URL}${route}`, { headers }); const data = await res.json().catch(() => ({})); if (!res.ok || data.ok === false) throw new Error(`${route} failed: ${res.status} ${data.error || data.message || ""}`.trim()); return data; }

async function latestSession() {
  const [eventsData, liveData] = await Promise.all([
    getJson(`/api/agent-bridge/events?limit=200&ts=${Date.now()}`, { authenticated: true }),
    getJson(`/api/a2a/live-events?category=prediction-market-bots&limit=500&ts=${Date.now()}`, { authenticated: true }).catch(() => ({ events: [] }))
  ]);
  const allEvents = (eventsData.events || []).filter((event) => (event.agent_id || event.agentId || (event.agent && event.agent.id)) === AGENT_ID);
  const liveEvents = Array.isArray(liveData.events) ? liveData.events : (Array.isArray(liveData.data) ? liveData.data : []);
  const grouped = new Map();
  for (const event of allEvents) { const sid = event.session_id || event.sessionId; if (!sid) continue; const bucket = grouped.get(sid) || []; bucket.push(event); grouped.set(sid, bucket); }
  for (const sid of [currentSessionId(), ...Array.from(grouped.keys())]) {
    const sessionEvents = (grouped.get(sid) || []).slice().reverse();
    const receiptsData = await getJson(`/api/agent-bridge/receipts?sessionId=${encodeURIComponent(sid)}&ts=${Date.now()}`, { authenticated: true });
    const receipts = receiptsData.receipts || [];
    const sessionLive = liveEvents.filter((e) => (e.metadata?.sessionId || '') === sid || (e.sessionId || '') === sid);
    if (hasExecutorX402Proof({ sessionId: sid, events: sessionEvents, receipts, liveEvents: sessionLive })) continue;
    return { ok: true, session: { sessionId: sid, roles: buildRoleState(sessionEvents), events: sessionEvents, receipts } };
  }
  return { ok: true, session: null };
}

async function postEvent({ sessionId, role, type, runtimeId, payload, metadata = {}, source = 'external-llm-pm2-bot' }) { const body = { sessionId: sessionId || currentSessionId(), agentId: AGENT_ID, role, type, payload, payloadHash: sha256(payload), source, dryRun: true, metadata: { ...metadata, runtimeId } }; const res = await fetch(`${BASE_URL}/api/agent-bridge/events`, { method: 'POST', headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }); const data = await res.json().catch(() => ({})); if (!res.ok || !data.ok) throw new Error(`post event failed: ${res.status} ${data.error || ''}`); return { ...data, sessionId: body.sessionId, payloadHash: body.payloadHash }; }

async function postReceipt({ sessionId, payloadHash, metadata = {}, receiptType = 'dry_run' }) { const body = { sessionId, receiptType, payloadHash, metadata }; const res = await fetch(`${BASE_URL}/api/agent-bridge/receipts`, { method: 'POST', headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }); const data = await res.json().catch(() => ({})); if (!res.ok || !data.ok) throw new Error(`post receipt failed: ${res.status} ${data.error || ''}`); return data; }

async function safePostLiveEvent(eventType, details = {}) {
  if (!A2A_LIVE_EVENTS_TOKEN) {
    return { ok: false, skipped: true, error: 'missing_live_events_token' };
  }
  const payload = {
    agentId: AGENT_ID,
    agentName: details.agentName || AGENT_ID,
    category: 'prediction-market-bots',
    eventType: eventType || 'x402_paid',
    title: details.title || 'x402 payment settled',
    summary: details.summary || 'Executor external_trace x402 payment settled',
    txHash: details.txHash || null,
    amountAtomic: details.amountAtomic || null,
    currency: 'USDC',
    decision: 'success',
    confidence: 1,
    trace: Array.isArray(details.trace) && details.trace.length ? details.trace : ['executor', 'x402_paid'],
    metadata: {
      autoPublished: true,
      manualMirror: false,
      sessionId: details.sessionId || null,
      paymentId: details.paymentId || null,
      bridgePayloadHash: details.bridgePayloadHash || null,
      protocolTxMode: 'arc_testnet',
      reasoning: details.reasoning || 'executor external_trace x402 autopay'
    }
  };
  const res = await fetch(`${BASE_URL}/api/a2a/live-events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${A2A_LIVE_EVENTS_TOKEN}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const message = `safePostLiveEvent failed: ${res.status} ${data.error || data.message || ''}`.trim();
    console.error(message);
    return { ok: false, status: res.status, error: data.error || 'live_event_failed', message, response: data };
  }
  return data;
}

module.exports = { BASE_URL, AGENT_ID, sha256, currentSessionId, getJson, latestSession, postEvent, postReceipt, safePostLiveEvent };
