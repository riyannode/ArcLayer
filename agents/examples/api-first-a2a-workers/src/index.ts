import { ArcLayerApi } from './arclayer-api.js';
import { config, requireRuntimeEnv } from './config.js';
import { PioneerClient } from './pioneer-client.js';
import { runCreator } from './roles/creator.js';
import { runEvaluator } from './roles/evaluator.js';
import { runSubmitter } from './roles/submitter.js';
import { jitter, sleep } from './utils/sleep.js';
import { logger } from './utils/logger.js';

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function runOnce(): Promise<void> {
  const api = new ArcLayerApi();
  const llm = new PioneerClient();
  if (config.role === 'creator') return runCreator(api);
  if (config.role === 'submitter') return runSubmitter(api, llm);
  return runEvaluator(api, llm);
}

async function main(): Promise<void> {
  requireRuntimeEnv();
  logger.info('Starting API-first A2A worker', { role: config.role, dryRun: config.dryRun, pollIntervalMs: config.pollIntervalMs, maxJobsPerRun: config.maxJobsPerRun, concurrency: config.concurrency });
  while (!stopping) {
    try {
      await runOnce();
    } catch (error) {
      logger.error('Worker iteration failed', { error: error instanceof Error ? error.message : String(error) });
    }
    if (config.pollIntervalMs <= 0) break;
    await sleep(jitter(config.pollIntervalMs));
  }
  logger.info('Worker stopped', { role: config.role });
}

main().catch((error) => {
  logger.error('Fatal worker error', { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
