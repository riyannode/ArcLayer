require('dotenv/config');
const { latestSession, postEvent } = require('./shared/arclayer-client');

function evaluate(session) {
  const analyzer = session?.roles?.analyzer || session?.roles?.momentum_resolver;
  const confidence = Number(analyzer?.payload?.confidence ?? 0);
  const suggestedDirection = analyzer?.payload?.suggestedDirection || 'NEUTRAL';
  const approved = suggestedDirection !== 'NEUTRAL' && confidence >= 56;
  return {
    approved,
    score: confidence,
    riskLevel: confidence >= 70 ? 'LOW' : confidence >= 56 ? 'MEDIUM' : 'HIGH',
    rationale: approved
      ? `Approved DRY_RUN intent for ${suggestedDirection}; confidence ${confidence}.`
      : 'Rejected/skip: neutral signal or insufficient confidence.',
    policy: 'DRY_RUN_ONLY_NO_REAL_TRADING',
  };
}

async function main() {
  const data = await latestSession();
  if (!data.session?.sessionId) throw new Error('no latest bridge session; run oracle/analyzer first');
  const payload = evaluate(data.session);
  await postEvent({
    sessionId: data.session.sessionId,
    role: 'evaluator',
    type: 'evaluation',
    runtimeId: process.env.RUNTIME_ID || 'pm2-evaluator-bot',
    payload,
  });
}

main().catch((err) => {
  console.error(`[evaluator] ${err.message}`);
  process.exitCode = 1;
});
