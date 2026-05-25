const origin = process.env.ARCLAYER_WEB_ORIGIN || 'https://arclayers.xyz';
const token = process.env.A2A_LIVE_EVENTS_TOKEN;

if (!token) {
  console.error('A2A_LIVE_EVENTS_TOKEN is required');
  process.exit(1);
}


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
  : [];

if (bots.length === 0) {
  console.error('PREDICTION_AGENT_IDS is required and must include at least one agent id (format: "id" or "id:name", comma-separated)');
  process.exit(1);
}



async function post(path, body) {
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
    await post('/api/a2a/presence', {
      agentId,
      agentName,
      status: 'online',
      lastEventType: 'heartbeat',
      lastEventSummary: 'bot heartbeat',
    });
  }
  console.log(new Date().toISOString(), 'heartbeat ok');
}

await tick();
setInterval(() => tick().catch((err) => console.error(err.message)), 15_000);
