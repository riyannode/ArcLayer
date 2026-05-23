require('dotenv/config');
const { latestSession, postEvent } = require('./shared/arclayer-client');

function hasLocalLlmKey() {
  const key = process.env.LLM_API_KEY || '';
  return Boolean(key && !key.toLowerCase().includes('replace'));
}

function deterministicAnalyze(session) {
  const oracle = session?.roles?.oracle;
  const market = oracle?.payload?.market;
  const up = Number(market?.upPrice ?? 0.5);
  const down = Number(market?.downPrice ?? 0.5);
  const spread = Math.abs(up - down);
  const suggestedDirection = spread < 0.015 ? 'NEUTRAL' : up > down ? 'UP' : 'DOWN';
  const confidence = Math.min(90, Math.max(50, Math.round(50 + spread * 1000)));
  return {
    source: 'deterministic-local-dry-run',
    summary: `Local analyzer read BTC 15m raw feed; ${suggestedDirection} edge=${spread.toFixed(3)}.`,
    confidence,
    rationale: [
      'Uses ArcLayer raw Polymarket BTC 15m feed only',
      'LLM key remains local when configured',
      'No trading strategy or executor private key lives in apps/console',
    ],
    suggestedDirection,
    noTradeReason: suggestedDirection === 'NEUTRAL' ? 'Spread below 1.5 percentage point threshold.' : null,
    llmConfigured: hasLocalLlmKey(),
  };
}

async function analyzeWithLocalLlm(session, fallback) {
  if (!hasLocalLlmKey()) return fallback;

  const baseUrl = (process.env.LLM_BASE_URL || process.env.LOCAL_LLM_BASE_URL || 'http://localhost:20128/v1').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || 'KIRO';
  const oraclePayload = session?.roles?.oracle?.payload || {};
  const prompt = [
    'You are a local-only dry-run market analyzer for an ArcLayer external PM2 market agent bridge example.',
    'Analyze the raw Polymarket BTC 15m payload and return compact JSON only.',
    'No real trade execution. No private keys. Do not include secrets.',
    'Schema: {"summary":string,"confidence":number,"suggestedDirection":"UP"|"DOWN"|"NEUTRAL","rationale":string[],"noTradeReason":string|null}',
    `Raw oracle payload: ${JSON.stringify(oraclePayload).slice(0, 6000)}`,
  ].join('\n');

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.LLM_API_KEY}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: 'Return JSON only. Never reveal or transform API keys.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`local LLM provider returned ${res.status}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
    return {
      ...fallback,
      ...parsed,
      source: 'local-llm-dry-run',
      llmConfigured: true,
      rationale: Array.isArray(parsed.rationale) ? parsed.rationale.slice(0, 5) : fallback.rationale,
    };
  } catch (error) {
    return {
      ...fallback,
      source: 'deterministic-local-dry-run',
      llmFallbackReason: error.message,
    };
  }
}

async function analyze(session) {
  const fallback = deterministicAnalyze(session);
  return analyzeWithLocalLlm(session, fallback);
}

async function main() {
  const data = await latestSession();
  if (!data.session?.sessionId) throw new Error('no latest bridge session; run oracle-bot first');
  const payload = await analyze(data.session);
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
