import { ArcLayerApi, type A2AJob } from '../arclayer-api.js';
import { config } from '../config.js';
import { PioneerClient } from '../pioneer-client.js';
import { contentHash, stableJson } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { submitOnchain } from '../wallet.js';

function promptFor(job: A2AJob): string {
  return `ArcLayer A2A job ${job.id}
Title: ${job.title ?? ''}
Description: ${job.description ?? ''}
Input: ${stableJson(job.input ?? {})}`;
}

export async function runSubmitter(api: ArcLayerApi, llm: PioneerClient): Promise<void> {
  const jobs = (await api.listJobs({ status: 'open', agentId: config.arclayerAgentId, roleId: 'submitter' })).slice(0, config.maxJobsPerRun);
  if (jobs.length === 0) {
    logger.info('No submitter jobs found');
    return;
  }
  for (const job of jobs) {
    llm.resetBudget();
    logger.info('Processing submitter job', { jobId: job.id, isOnchain: job.is_onchain, onchainJobId: job.onchain_job_id });
    if (!config.dryRun) {
      try {
        await api.claimJob(job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('ArcLayer API 404:') || /unsupported/i.test(message)) {
          logger.warn('Claim route unavailable; continuing to submit', { jobId: job.id, error: message });
        } else {
          throw error;
        }
      }
    }
    const result = await llm.complete(promptFor(job));
    const deliverableUri = `urn:arclayer:deliverable:${job.id}`;
    const proofUri = `urn:arclayer:proof:${job.id}`;
    const deliverableHash = contentHash({ jobId: job.id, output: result.output, proof: result.proof });
    let submitTx: string | undefined;
    if (job.is_onchain && job.onchain_job_id && config.enableOnchainSubmit) {
      if (config.dryRun) logger.info('Submitter dry-run: would submit ERC-8183 deliverable', { onchainJobId: String(job.onchain_job_id), deliverableHash });
      else submitTx = await submitOnchain(job.onchain_job_id, deliverableHash);
    }
    const payload = { output: result.output, proof: result.proof, summary: result.summary, deliverable_uri: deliverableUri, deliverable_hash: deliverableHash, proof_uri: proofUri, ...(submitTx ? { submit_tx: submitTx } : {}) };
    if (config.dryRun) logger.info('Submitter dry-run: would POST /submit', { jobId: job.id, payload });
    else logger.info('Submitted A2A job', { jobId: job.id, response: await api.submitJob(job.id, payload) });
  }
}
