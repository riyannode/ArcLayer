import { ArcLayerApi, type A2AJob } from '../arclayer-api.js';
import { config } from '../config.js';
import { PioneerClient } from '../pioneer-client.js';
import { contentHash, stableJson } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { addressFromPrivateKey, completeOnchain } from '../wallet.js';

function sameAddress(a?: string | null, b?: string | null): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function promptFor(job: A2AJob): string {
  return `Evaluate ArcLayer A2A job ${job.id}. Return approval reason.
Output: ${stableJson(job.output ?? {})}
Proof: ${stableJson(job.proof ?? {})}`;
}

export async function runEvaluator(api: ArcLayerApi, llm: PioneerClient): Promise<void> {
  const evaluatorAddress = config.evaluatorPrivateKey ? addressFromPrivateKey(config.evaluatorPrivateKey) : undefined;
  const jobs = (await api.listJobs({ status: 'submitted', ...(evaluatorAddress ? { evaluator: evaluatorAddress } : {}) }))
    .filter((job) => {
      if (!job.is_onchain || !job.onchain_job_id) {
        logger.info('Skipping legacy/off-chain submitted job', { jobId: job.id, isOnchain: job.is_onchain, onchainJobId: job.onchain_job_id });
        return false;
      }
      if (job.evaluator && evaluatorAddress && !sameAddress(job.evaluator, evaluatorAddress)) {
        logger.info('Skipping on-chain job assigned to different evaluator', { jobId: job.id, evaluator: job.evaluator, workerEvaluator: evaluatorAddress });
        return false;
      }
      return true;
    })
    .slice(0, config.maxJobsPerRun);
  if (jobs.length === 0) {
    logger.info('No evaluator jobs found');
    return;
  }
  for (const job of jobs) {
    llm.resetBudget();
    logger.info('Processing evaluator job', { jobId: job.id, isOnchain: job.is_onchain, onchainJobId: job.onchain_job_id });
    const result = await llm.complete(promptFor(job));
    const reasonHash = contentHash({ jobId: job.id, summary: result.summary, proof: result.proof });
    let completeTx: string | undefined;
    if (job.is_onchain && job.onchain_job_id && config.enableOnchainComplete) {
      if (config.dryRun) logger.info('Evaluator dry-run: would complete ERC-8183 job', { onchainJobId: String(job.onchain_job_id), reasonHash });
      else completeTx = await completeOnchain(job.onchain_job_id, reasonHash);
    }
    const payload = { approved: true, summary: result.summary, reason: result.summary, reason_hash: reasonHash, proof: result.proof, ...(completeTx ? { complete_tx: completeTx } : {}) };
    if (config.dryRun) logger.info('Evaluator dry-run: would POST /complete', { jobId: job.id, payload });
    else logger.info('Completed A2A job', { jobId: job.id, response: await api.completeJob(job.id, payload) });
  }
}
