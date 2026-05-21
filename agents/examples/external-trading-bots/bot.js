#!/usr/bin/env node
/* Example external trading bot bridge client.
 * Strategy/model/API-key logic belongs here, outside apps/console.
 * Never log env secrets.
 */

const crypto = require('node:crypto');

const baseUrl = process.env.ARCLAYER_BASE_URL || 'https://arclayers.xyz';
const apiKey = process.env.ARCLAYER_API_KEY;
const agentId = process.env.ARCLAYER_AGENT_ID;
const role = process.env.BOT_ROLE || 'oracle';
const dryRun = process.env.DRY_RUN !== 'false';
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || 15000);
const sessionId = process.env.SESSION_ID || `trade_${Date.now()}`;

if (!apiKey || !agentId) {
  console.error('[bot] missing ARCLAYER_API_KEY or ARCLAYER_AGENT_ID');
  process.exit(1);
}

function sha256(value) {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

async function getLatest() {
  const res = await fetch(`${baseUrl}/api/agent-bridge/sessions/latest`, { headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  return data.session || null;
}

function runLocalLogic(latest) {
  // Placeholder only. Replace with bot-owned model/strategy logic.
  const now = new Date().toISOString();
  if (role === 'oracle') {
    return { type: 'market_snapshot', payload: { asset: 'BTC', timeframe: '15m', source: 'placeholder', observedAt: now } };
  }
  if (role === 'momentum_resolver' || role === 'scalping_resolver') {
    return { type: 'resolver_output', payload: { action: 'NO_TRADE', confidence: 0, rationale: 'placeholder external bot output', latestSessionId: latest?.sessionId ?? null } };
  }
  if (role === 'evaluator') {
    return { type: 'evaluation', payload: { approved: false, finalAction: 'SKIP', score: 0, riskLevel: 'HIGH', rationale: 'placeholder external arbiter output' } };
  }
  return { type: 'execution_intent', payload: { action: 'SKIP', mode: 'DRY_RUN', sizeUsdc: '0', rationale: 'placeholder dry-run executor output' } };
}

async function postEvent(event) {
  const body = {
    sessionId,
    agentId,
    role,
    type: event.type,
    payload: event.payload,
    payloadHash: sha256(event.payload),
    source: 'pm2-bot',
    dryRun,
  };
  const res = await fetch(`${baseUrl}/api/agent-bridge/events`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  console.log(`[bot:${role}] posted ${event.type} ${data.eventId}`);
}

async function tick() {
  try {
    const latest = await getLatest();
    await postEvent(runLocalLogic(latest));
  } catch (err) {
    console.error(`[bot:${role}]`, err.message);
  }
}

tick();
setInterval(tick, Math.max(pollIntervalMs, 5000));
