/**
 * Verify a submitted job
 */
require('dotenv').config();
const { verifyJob } = require('./shared/job-client');

const VERIFIER_AGENT_ID = process.env.VERIFIER_AGENT_ID || 'agent_verifier_001';

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: node verify-job.js <jobId> [approved]');
    process.exit(1);
  }

  const approved = process.argv[3] !== 'false';

  const result = await verifyJob({
    jobId,
    verifierAgentId: VERIFIER_AGENT_ID,
    approved,
    reason: approved ? 'Result meets quality threshold' : 'Result does not meet requirements',
    metadata: {
      verifiedBy: 'auto-verifier',
      verificationMethod: 'deterministic_check',
    },
  });

  console.log(`Verification result: ${approved ? 'APPROVED' : 'REJECTED'}`);
  console.log(JSON.stringify(result.job, null, 2));
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
