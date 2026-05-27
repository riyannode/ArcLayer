const origin = process.env.ARCLAYER_WEB_ORIGIN || 'https://arclayers.xyz';

const defaults = [
  ['19803', 'ArcLayer Prediction Analyzer'],
  ['19804', 'ArcLayer Prediction Evaluator'],
  ['19805', 'ArcLayer Prediction Executor'],
  ['19806', 'ArcLayer Prediction Oracle'],
];

const rawAgentIds = process.env.PREDICTION_AGENT_IDS?.trim() || '';
const bots = rawAgentIds
  ? rawAgentIds
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [agentId, ...nameParts] = entry.split(':');
        return [agentId ? agentId.trim() : '', nameParts.join(':').trim()];
      })
      .filter(([agentId]) => agentId)
      .map(([agentId, name]) => [agentId, name || `Agent ${agentId}`])
  : defaults;

// --- Auth resolution ---

function buildTokenMap() {
  if (process.env.A2A_LIVE_EVENTS_TOKEN) {
    return null; // global token mode — single token applies to all agents
  }

  if (process.env.PREDICTION_AGENT_KEYS) {
    const map = new Map();
    const pairs = process.env.PREDICTION_AGENT_KEYS.split(',').map((s) => s.trim()).filter(Boolean);
    for (const pair of pairs) {
      const idx = pair.indexOf(':');
      if (idx === -1) continue;
      const agentId = pair.slice(0, idx).trim();
      const apiKey = pair.slice(idx + 1).trim();
      if (agentId && apiKey) map.set(agentId, apiKey);
    }
    return map;
  }

  if (process.env.ARCLAYER_API_KEY) {
    if (bots.length > 1) {
      console.error('Multiple prediction agents require A2A_LIVE_EVENTS_TOKEN or PREDICTION_AGENT_KEYS.');
      process.exit(1);
    }
    const map = new Map();
    map.set(bots[0][0], process.env.ARCLAYER_API_KEY);
    return map;
  }

  console.error('A2A_LIVE_EVENTS_TOKEN, PREDICTION_AGENT_KEYS, or ARCLAYER_API_KEY is required');
  process.exit(1);
}

function tokenForAgent(agentId, tokenMap) {
  if (!tokenMap) {
    // Global token mode — A2A_LIVE_EVENTS_TOKEN
    return process.env.A2A_LIVE_EVENTS_TOKEN;
  }
  return tokenMap.get(agentId);
}

const tokenMap = buildTokenMap();

async function post(path, body, token) {
  const res = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} failed ${res.status}: ${text}`);
  }
}

async function tick() {
  for (const [agentId, agentName] of bots) {
    const authToken = tokenForAgent(agentId, tokenMap);
    if (!authToken) {
      console.error(`[heartbeat] missing token for agent ${agentId}`);
      continue;
    }
    await post('/api/a2a/presence', {
      agentId,
      agentName,
      status: 'online',
      lastEventType: 'heartbeat',
      lastEventSummary: 'bot heartbeat',
    }, authToken);
  }
  console.log(new Date().toISOString(), 'heartbeat ok');
}

await tick();
setInterval(() => tick().catch((err) => console.error(err.message)), 15_000);
