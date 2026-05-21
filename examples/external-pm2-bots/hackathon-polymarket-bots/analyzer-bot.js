require('dotenv/config');
const { latestSession, postEvent } = require('./shared/arclayer-client');

function analyze(session) {
  const oracle = session?.roles?.oracle;
  const market = oracle?.payload?.market;
  const up = Number(market?.upPrice ?? 0.5);
  const down = Number(market?.downPrice ?? 0.5);
  const spread = Math.abs(up - down);
  const suggestedDirection = spread < 0.015 ? 'NEUTRAL' : up > down ? 'UP' : 'DOWN';
  const confidence = Math.min(90, Math.max(50, Math.round(50 + spread * 1000)));
  return {
    summary: `Local analyzer read BTC 15m raw feed; ${suggestedDirection} edge=${spread.toFixed(3)}.` ,
    confidence,
    rationale: ['Uses ArcLayer raw data feed only', 'LLM key remains local if configured', 'No strategy stored inside apps/console'],
    suggestedDirection,
    noTradeReason: suggestedDirection === 'NEUTRAL' ? 'Spread below 1.5 percentage point threshold.' : null,
    llmConfigured: Boolean(process.env.LLM_API_KEY && !process.env.LLM_API_KEY.includes('replace')),
  };
}

async function main() {
  const data = await latestSession();
  if (!data.session?.sessionId) throw new Error('no latest bridge session; run oracle-bot first');
  const payload = analyze(data.session);
  await postEvent({
    sessionId: data.session.sessionId,
    role: 'analyzer',
    type: 'resolver_output',
    runtimeId: process.env.RUNTIME_ID || 'pm2-analyzer-bot',
    payload,
  });
}

main().catch((err) => {
  console.error(`[analyzer] ${err.message}`);
  process.exitCode = 1;
});
