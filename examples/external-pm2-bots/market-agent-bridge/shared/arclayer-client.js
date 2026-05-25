const crypto = require("node:crypto");

const BASE_URL = (process.env.ARCLAYER_BASE_URL || "https://arclayers.xyz").replace(/\/$/, "");
const API_KEY = process.env.ARCLAYER_API_KEY || "";
const A2A_LIVE_EVENTS_TOKEN = process.env.A2A_LIVE_EVENTS_TOKEN || "";

// Strict AGENT_ID validation: support ARCLAYER_AGENT_ID and AGENT_ID
// but fail if both exist and mismatch
const _envAgentId = process.env.ARCLAYER_AGENT_ID || process.env.AGENT_ID || "";
const _envAgentIdAlt = process.env.AGENT_ID || "";
if (process.env.ARCLAYER_AGENT_ID && _envAgentIdAlt && process.env.ARCLAYER_AGENT_ID !== _envAgentIdAlt) {
  throw new Error(`AGENT_ID mismatch: ARCLAYER_AGENT_ID="${process.env.ARCLAYER_AGENT_ID}" !== AGENT_ID="${_envAgentIdAlt}". Use only one.`);
}
if (!_envAgentId) {
  throw new Error("ARCLAYER_AGENT_ID or AGENT_ID is required but missing");
}
if (!API_KEY) {
  throw new Error("ARCLAYER_API_KEY is required but missing");
}
const AGENT_ID = _envAgentId;
const AGENT_CATEGORY = process.env.AGENT_CATEGORY || "prediction-market-bots";

function sha256(payload) { return `0x${crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex")}`; }
function currentSessionId() { const bucket = Math.floor(Date.now() / (15 * 60 * 1000)) * 15 * 60; return `btc15m_${bucket}`; }

function isValidTxHash(value) { return typeof value === 'string' && /^0x[a-fA-F0-9]{64}$/.test(value); }

/** Content event types that carry actionable payload, vs administrative types like receipt_reference */
const CONTENT_EVENT_TYPES = new Set(['resolver_output', 'evaluation', 'execution_intent', 'market_snapshot']);

/** Normalize event field: try candidates in order, return first defined non-null value */
function norm(event, candidates) {
  for (const k of candidates) {
    const v = event[k] ?? event.payload?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function normalizeEvent(event) {
  return {
    ...event,
    sessionId: norm(event, ['sessionId', 'session_id', 'payload.unlockedSessionId']),
    role: (norm(event, ['role', 'metadata.role', 'payload.paidByRole']) || '').toString(),
    type: (norm(event, ['type', 'eventType', 'event_type']) || '').toString(),
  };
}

/**
 * Build role state from session events.
 * Events are iterated newest-first (API returns newest-first, no reverse needed).
 * For each role, prefer the NEWEST content-type event.
 * Receipt_reference events are only stored if no content event exists for that role.
 */
function buildRoleState(events) {
  const roles = {};
  // Track whether we already stored a content-type event per role
  const hasContent = {};
  for (const event of events) {
    const normalized = normalizeEvent(event);
    const role = normalized.role;
    if (!role) continue;
    const normalizedType = normalized.type;
    const isContent = CONTENT_EVENT_TYPES.has(normalizedType);
    // Always store first occurrence (newest), unless it's receipt_reference and we already have a content event
    if (roles[role]) {
      // Already stored: only overwrite if existing is receipt_reference and current is content
      if (isContent && !hasContent[role]) {
        roles[role] = {
          payload: event.payload || {},
          type: normalizedType,
          eventId: event.id || event.eventId || null,
        };
        hasContent[role] = true;
      }
      // Otherwise skip (keep existing)
    } else {
      roles[role] = {
        payload: event.payload || {},
        type: normalizedType,
        eventId: event.id || event.eventId || null,
      };
      if (isContent) hasContent[role] = true;
    }
  }
  return roles;
}

/**
 * Lightweight check: does the session already have ANY executor receipt_reference
 * x402 bridge event? Checks only events (no receipt/live round-trip).
 * Used for duplicate prevention before posting proofs.
 */
/**
 * Generic helper: check if a role already has a content-type event for this session.
 * Uses normalizeEvent() for field normalization.
 * Returns true only when event is a content event (not receipt_reference)
 * matching sessionId, role, and type.
 */
function hasRoleContentEvent({ sessionId, events, role, type }) {
  return (events || []).some((e) => {
    const n = normalizeEvent(e);
    if (n.sessionId !== sessionId) return false;
    if (n.role !== role) return false;
    if (n.type !== type) return false;
    return CONTENT_EVENT_TYPES.has(n.type);
  });
}

function hasExecutorX402EventOnly({ sessionId, events }) {
  return (events || []).some((e) => {
    const n = normalizeEvent(e);
    const p = e.payload || {};
    const tx = p.txHash || p.transaction || e.txHash || e.transaction;
    return n.role === 'executor' &&
      n.type === 'receipt_reference' &&
      n.sessionId === sessionId &&
      (p.scope || '').toString() === 'external_trace' &&
      (p.source || e.source || '').toString() === 'x402-autopay' &&
      isValidTxHash(tx);
  });
}

function hasExecutorX402Proof({ sessionId, events, receipts, liveEvents }) {
  const eventProofs = (events || []).filter((e) => {
    const n = normalizeEvent(e);
    const p = e.payload || {};
    const tx = p.txHash || p.transaction || e.txHash || e.transaction;
    return n.role === 'executor' &&
      n.type === 'receipt_reference' &&
      n.sessionId === sessionId &&
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

async function getJson(route, options = {}) {
  const headers = { accept: "application/json" };
  if (options.authenticated) headers.authorization = `Bearer ${API_KEY}`;
  const res = await fetch(`${BASE_URL}${route}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(`${route} failed: ${res.status} ${data.error || data.message || ""}`.trim());
  return data;
}

/**
 * Find latest session for the calling role.
 * Uses category-based event fetching so downstream roles (analyzer, evaluator, executor)
 * can read upstream events from other agent IDs in the same category/session.
 * Role matching is based on event.role and event.type, not local agentId.
 *
 * @param {Object} options
 * @param {string[]} [options.requiredRoles] - upstream roles the caller needs (e.g. ['analyzer'] for evaluator)
 * @returns {Promise<{ok:true, session:{sessionId,roles,events,receipts}|null}>}
 */
async function latestSession(options = {}) {
  const requiredRoles = options.requiredRoles || [];
  const [eventsData, liveData] = await Promise.all([
    getJson(`/api/agent-bridge/events?category=${encodeURIComponent(AGENT_CATEGORY)}&limit=200&ts=${Date.now()}`, { authenticated: true }),
    getJson(`/api/a2a/live-events?category=prediction-market-bots&limit=500&ts=${Date.now()}`, { authenticated: true }).catch(() => ({ events: [] }))
  ]);
  // Do NOT filter by local AGENT_ID — downstream roles must read events from other agent IDs
  // in the same category/session. Role matching is done by event.role and event.type.
  const allEvents = eventsData.events || [];
  const liveEvents = Array.isArray(liveData.events) ? liveData.events : (Array.isArray(liveData.data) ? liveData.data : []);

  // Group events by normalized sessionId
  const grouped = new Map();
  for (const event of allEvents) {
    const n = normalizeEvent(event);
    const sid = n.sessionId;
    if (!sid) continue;
    // Re-attach normalized fields onto the event for downstream use
    event._normalized = n;
    const bucket = grouped.get(sid) || [];
    bucket.push(event);
    grouped.set(sid, bucket);
  }

  // Iterate sessions: current bucket first (if has events), then existing sessions by recency
  const currentSid = currentSessionId();
  const candidateSids = [];
  if (grouped.has(currentSid)) candidateSids.push(currentSid);
  for (const sid of Array.from(grouped.keys()).reverse()) {
    if (sid !== currentSid) candidateSids.push(sid);
  }

  for (const sid of candidateSids) {
    const sessionEvents = grouped.get(sid) || [];

    // Skip empty sessions
    if (sessionEvents.length === 0) {
      console.log(`[session] skip session=${sid} reason=empty_events`);
      continue;
    }

    const roles = buildRoleState(sessionEvents);
    const roleKeys = Object.keys(roles);

    // Check required upstream roles exist
    const missingRole = requiredRoles.find((r) => !roleKeys.includes(r));
    if (missingRole) {
      console.log(`[session] skip session=${sid} reason=missing_required_role roles=${roleKeys.join(',')} missing=${missingRole}`);
      continue;
    }

    const receiptsData = await getJson(`/api/agent-bridge/receipts?sessionId=${encodeURIComponent(sid)}&ts=${Date.now()}`, { authenticated: true });
    const receipts = receiptsData.receipts || [];
    const sessionLive = liveEvents.filter((e) => {
      const m = e.metadata || {};
      return (m.sessionId || '').toString() === sid || (e.sessionId || '') === sid;
    });

    // Skip if executor already has x402 proof (autopay already done)
    if (hasExecutorX402Proof({ sessionId: sid, events: sessionEvents, receipts, liveEvents: sessionLive })) {
      console.log(`[session] skip session=${sid} reason=executor_x402_exists roles=${roleKeys.join(',')}`);
      continue;
    }

    console.log(`[session] selected session=${sid} roles=${roleKeys.join(',')}`);
    return { ok: true, session: { sessionId: sid, roles, events: sessionEvents, receipts } };
  }

  console.log(`[session] no matching session for requiredRoles=[${requiredRoles.join(',')}]`);
  return { ok: true, session: null };
}

async function postEvent({ sessionId, role, type, runtimeId, payload, metadata = {}, source = 'external-llm-pm2-bot' }) {
  const body = {
    sessionId: sessionId || currentSessionId(),
    agentId: AGENT_ID,
    category: AGENT_CATEGORY,
    role,
    type,
    payload,
    payloadHash: sha256(payload),
    source,
    dryRun: true,
    metadata: { ...metadata, runtimeId }
  };
  const res = await fetch(`${BASE_URL}/api/agent-bridge/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`post event failed: ${res.status} ${data.error || ''}`);
  return { ...data, sessionId: body.sessionId, payloadHash: body.payloadHash };
}

async function postReceipt({ sessionId, payloadHash, metadata = {}, receiptType = 'x402_arc_native' }) {
  const body = { sessionId, receiptType, payloadHash, metadata };
  const res = await fetch(`${BASE_URL}/api/agent-bridge/receipts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`post receipt failed: ${res.status} ${data.error || ''}`);
  return data;
}

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

module.exports = { BASE_URL, AGENT_ID, AGENT_CATEGORY, sha256, currentSessionId, getJson, hasRoleContentEvent, hasExecutorX402EventOnly, hasExecutorX402Proof, latestSession, postEvent, postReceipt, safePostLiveEvent };
