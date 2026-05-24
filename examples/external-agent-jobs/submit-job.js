/**
 * Submit a job result
 */
require('dotenv').config();
const { submitJob } = require('./shared/job-client');

const WORKER_ID = process.env.WORKER_ID || 'agent_worker_001';

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: node submit-job.js <jobId>');
    process.exit(1);
  }

  const resultPayload = {
    analysis: {
      signal: 'bullish',
      confidence: 0.75,
      reasoning: 'Strong momentum detected on 15m timeframe',
      indicators: {
        rsi: 62,
        macd: 'bullish_cross',
      },
    },
    processedAt: new Date().toISOString(),
  };

  const proofPayload = {
    model: 'deepseek-v4-flash',
    inputTokens: 450,
    outputTokens: 120,
    processingTimeMs: 2340,
  };

  const result = await submitJob({
    jobId,
    workerId: WORKER_ID,
    resultPayload,
    proofPayload,
  });

  console.log('Submitted:');
  console.log(JSON.stringify(result.job, null, 2));
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
