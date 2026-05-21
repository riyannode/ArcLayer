import { ArcLayerApi } from '../arclayer-api.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export async function runCreator(api: ArcLayerApi): Promise<void> {
  const body = {
    title: config.creatorJobTitle,
    description: config.creatorJobDescription,
    category: config.creatorJobCategory,
    roleId: config.creatorJobRoleId,
    requester: config.arclayerAgentId || 'external-api-worker',
    input: { source: 'api-first-a2a-workers', dryRun: config.dryRun },
  };
  if (config.dryRun || !config.enableX402CreateJob) {
    logger.info('Creator dry-run: x402 create disabled, not posting job', { body, enableX402CreateJob: config.enableX402CreateJob });
    return;
  }
  const job = await api.createJob(body);
  logger.info('Created A2A job', { jobId: job.id });
}
