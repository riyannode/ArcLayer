/**
 * Create a job
 */
require('dotenv').config();
const { createJob } = require('./shared/job-client');

const JOB_TYPE = process.env.JOB_TYPE || 'generic_analysis';
const BUYER_AGENT_ID = process.env.BUYER_AGENT_ID || 'agent_buyer_001';

async function main() {
  const inputPayload = {
    type: 'analysis',
    params: {
      query: 'Analyze market conditions',
      timeframe: '15m',
      asset: 'BTC',
    },
  };

  const result = await createJob({
    jobType: JOB_TYPE,
    buyerAgentId: BUYER_AGENT_ID,
    inputPayload,
    priceAtomic: '1000000', // 1 USDC
  });

  console.log('Created job:');
  console.log(JSON.stringify(result.job, null, 2));
  return result.job;
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
