const crypto = require("node:crypto");

const BASE_URL = (process.env.ARCLAYER_BASE_URL || "https://arclayers.xyz").replace(/\/$/, "");
const API_KEY = process.env.ARCLAYER_API_KEY || "";
const A2A_LIVE_EVENTS_TOKEN = process.env.A2A_LIVE_EVENTS_TOKEN || "";
const AGENT_ID = process.env.ARCLAYER_AGENT_ID || "llm-market-agent";

function sha256(payload) { return `0x${crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex")}`; }
function currentSessionId() { const bucket = Math.floor(Date.now() / (15 * 60 * 1000)) * 15 * 60; return `btc15m_${bucket}`; }
async function getJson(route, options = {}) { const headers = { accept: "application/json" }; if (options.authenticated) headers.authorization = `Bearer ${API_KEY}`; const res = await fetch(`${BASE_URL}${route}`, { headers }); const data = await res.json().catch(() => ({})); if (!res.ok || data.ok === false) throw new Error(`${route} failed: ${res.status} ${data.error || data.message || ""}`.trim()); return data; }

async function latestSession() {
  const eventsData = await getJson(`/api/agent-bridge/events?limit=200&ts=${Date.now()}`, { authenticated: true });
  const events = (eventsData.events || []).filter((event) => (event.agent_id || event.agentId || (event.agent && event.agent.id)) === AGENT_ID);
  const grouped = new Map();
  for (const event of events) { const sid = event.session_id || event.sessionId; if (!sid) continue; const bucket = grouped.get(sid) || []; bucket.push(event); grouped.set(sid, bucket); }
  for (const sid of [currentSessionId(), ...Array.from(grouped.keys())]) {
    const receiptsData = await getJson(`/api/agent-bridge/receipts?sessionId=${encodeURIComponent(sid)}&ts=${Date.now()}`, { authenticated: true });
    const receipts = receiptsData.receipts || [];
    const hasExecutorX402 = receipts.some((r) => {
      const type = r.receipt_type || r.receiptType;
      const meta = r.metadata || {};
      const tx = meta.txHash || r.transaction || r.tx_hash;
      return (type === 'x402_payment_proof' || type === 'x402_arc_native') && meta.role === 'executor' && meta.scope === 'external_trace' && meta.source === 'x402-autopay' && typeof tx === 'string' && tx.startsWith('0x');
    });
    if (hasExecutorX402) continue;
    return { ok: true, session: { sessionId: sid, roles: {}, events: events.filter((e) => (e.session_id || e.sessionId) === sid).reverse(), receipts } };
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
