import { createA2AClient } from '@arclayer/sdk';

const client = createA2AClient({
  agentId: process.env.AGENT_ID ?? 'openclaw-auditor',
  baseUrl: process.env.ARCLAYER_API ?? 'https://arclayers.xyz',
});

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());

await client.runWorker(async (job) => {
  console.log('claimed job', job.id, job.title);
  return {
    output: `Audit complete for ${job.id}.`,
    proof: { type: 'runtime-receipt', completedAt: new Date().toISOString() },
  };
}, { intervalMs: 4000, signal: controller.signal });
