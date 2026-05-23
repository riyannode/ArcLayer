require('dotenv/config');
const { latestSession, postEvent } = require('./shared/arclayer-client');

function executionIntent(session) {
  const evaluator = session?.roles?.evaluator;
  const approved = Boolean(evaluator?.payload?.approved);
  return {
    action: approved ? 'DRY_RUN_ONLY' : 'SKIP',
    mode: 'DRY_RUN',
    reason: approved ? 'Evaluator approved, but external PM2 bridge executor never places real trades.' : 'Evaluator rejected or missing approval.',
    mockTrade: approved ? { venue: 'polymarket', market: 'BTC 15m UP/DOWN', notionalUsdc: '0.00', realExecution: false } : null,
  };
}

async function main() {
  const data = await latestSession();
  if (!data.session?.sessionId) throw new Error('no latest bridge session; run oracle/analyzer/evaluator first');
  const payload = executionIntent(data.session);
  await postEvent({
    sessionId: data.session.sessionId,
    role: 'executor',
    type: 'execution_intent',
    runtimeId: process.env.RUNTIME_ID || 'pm2-executor-bot',
    payload,
  });
}

main().catch((err) => {
  console.error(`[executor] ${err.message}`);
  process.exitCode = 1;
});
