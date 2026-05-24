/**
 * 24/7 Worker — polls for jobs, claims, processes, and submits.
 * Safe with multiple worker processes (atomic claim via SKIP LOCKED).
 */
require('dotenv').config();
const { claimJob, markRunning, submitJob, getJob } = require('./shared/job-client');

const JOB_TYPE = process.env.JOB_TYPE || 'generic_analysis';
const WORKER_ID = process.env.WORKER_ID || 'agent_worker_001';
const PROVIDER_AGENT_ID = process.env.PROVIDER_AGENT_ID || 'agent_provider_001';
const POLL_INTERVAL = parseInt(process.env.JOB_POLL_INTERVAL_MS || '5000', 10);

function log(...args) {
  console.log(`[worker-24x7 ${new Date().toISOString()}]`, ...args);
}

async function processJob(job) {
  const jobId = job.job_id;
  log(`Processing job ${jobId}...`);

  // Mark running
  try {
    await markRunning({ jobId, workerId: WORKER_ID });
    log(`  Marked running`);
  } catch (err) {
    log(`  ERROR marking running: ${err.message}`);
    return;
  }

  // Simulate work
  const processingMs = Math.floor(Math.random() * 2000) + 500;
  log(`  Working... (${processingMs}ms)`);
  await new Promise((resolve) => setTimeout(resolve, processingMs));

  // Submit result
  try {
    const resultPayload = {
      analysis: {
        signal: Math.random() > 0.5 ? 'bullish' : 'bearish',
        confidence: Math.round((Math.random() * 40 + 50) / 100 * 100) / 100,
        processingTimeMs: processingMs,
      },
      processedAt: new Date().toISOString(),
    };

    const proofPayload = {
      workerId: WORKER_ID,
      model: 'auto-worker',
      executionTimeMs: processingMs,
    };

    await submitJob({ jobId, workerId: WORKER_ID, resultPayload, proofPayload });
    log(`  Submitted result`);
  } catch (err) {
    log(`  ERROR submitting: ${err.message}`);
  }
}

let running = true;

process.on('SIGINT', () => {
  log('Shutting down...');
  running = false;
});

async function main() {
  log(`Starting 24/7 worker (poll interval: ${POLL_INTERVAL}ms)`);

  while (running) {
    try {
      const result = await claimJob({
        jobType: JOB_TYPE,
        workerId: WORKER_ID,
        providerAgentId: PROVIDER_AGENT_ID,
        claimTtlSeconds: 600,
      });

      if (result.job) {
        await processJob(result.job);
      } else {
        log('No jobs available, waiting...');
      }
    } catch (err) {
      log(`Error during poll: ${err.message}`);
    }

    if (running) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
  }

  log('Worker stopped');
}

main().catch((err) => {
  log('Fatal error:', err.message);
  process.exit(1);
});
