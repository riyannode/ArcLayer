/**
 * Claim first available job
 */
require('dotenv').config();
const { claimJob } = require('./shared/job-client');

const JOB_TYPE = process.env.JOB_TYPE || 'generic_analysis';
const WORKER_ID = process.env.WORKER_ID || 'agent_worker_001';
const PROVIDER_AGENT_ID = process.env.PROVIDER_AGENT_ID || 'agent_provider_001';

async function main() {
  const result = await claimJob({
    jobType: JOB_TYPE,
    workerId: WORKER_ID,
    providerAgentId: PROVIDER_AGENT_ID,
    claimTtlSeconds: 300,
  });

  if (!result.job) {
    console.log('No jobs available to claim');
    return null;
  }

  console.log('Claimed job:');
  console.log(JSON.stringify(result.job, null, 2));
  return result.job;
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
