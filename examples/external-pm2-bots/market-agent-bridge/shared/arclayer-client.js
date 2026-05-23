const crypto = require('node:crypto');

const BASE_URL = (process.env.ARCLAYER_BASE_URL || 'https://arclayers.xyz').replace(/\/$/, '');
const API_KEY = process.env.ARCLAYER_API_KEY || '';
const AGENT_ID = process.env.ARCLAYER_AGENT_ID || 'external-pm2-market-agent';
const DRY_RUN = process.env.DRY_RUN !== 'false';
const CATEGORY = 'prediction-market';

function sha256(payload) {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex')}`;
}

function currentSessionId() {
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000)) * 15 * 60;
  return `btc15m_${bucket}`;
}

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(`${path} failed: ${res.status} ${data.error || ''}`.trim());
  return data;
}

async function latestSession() {
  return getJson('/api/agent-bridge/sessions/latest');
}

async function postEvent({ role, type, payload, runtimeId, sessionId, metadata = {}, source }) {
  if (!DRY_RUN) throw new Error('This external PM2 market agent bridge example is DRY_RUN only. Set DRY_RUN=true.');
  if (!API_KEY || API_KEY.includes('REPLACE')) throw new Error('Missing ARCLAYER_API_KEY placeholder not allowed for posting.');
  const body = {
    sessionId: sessionId || currentSessionId(),
    agentId: AGENT_ID,
    runtimeId: runtimeId || process.env.RUNTIME_ID || `pm2-${role}-bot`,
    role,
    type,
    payload,
    payloadHash: sha256(payload),
    source: source || 'external-pm2-market-agent-bridge',
    dryRun: true,
    category: CATEGORY,
    metadata: { ...metadata, demo: 'external pm2 market agent bridge', dryRunOnly: true },
  };
  const res = await fetch(`${BASE_URL}/api/agent-bridge/events`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${API_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`post event failed: ${res.status} ${data.error || data.message || ''}`.trim());
  console.log(`[${role}] posted ${type} session=${body.sessionId} hash=${body.payloadHash.slice(0, 12)}… event=${data.eventId}`);
  return data;
}

module.exports = {
  BASE_URL,
  AGENT_ID,
  DRY_RUN,
  CATEGORY,
  sha256,
  currentSessionId,
  getJson,
  latestSession,
  postEvent,
};
