import {
  readAgentProfile,
  readAllJobs,
  readJob,
  readJobCounter,
  readWorkProof,
  readWorkProofTokenByJobId,
} from "@arclayer/sdk";
import type { IndexedJobEvent } from "@arclayer/sdk";
import { INDEXER_RPC, mapWithLimit, withTimeout } from "./rpc-limit";

export function buildJobProjection(events: IndexedJobEvent[]) {
  return events.reduce<Record<string, IndexedJobEvent[]>>((acc, event) => {
    const key = String(event.jobId ?? "unassigned");
    acc[key] ??= [];
    acc[key].push(event);
    return acc;
  }, {});
}

export function buildAgentEventProjection(events: IndexedJobEvent[]) {
  return events.reduce<Record<string, IndexedJobEvent[]>>((acc, event) => {
    const key = String(event.agentId ?? "unknown");
    acc[key] ??= [];
    acc[key].push(event);
    return acc;
  }, {});
}

export async function buildJobsProjection() {
  const jobCounter = await withTimeout(readJobCounter(), "readJobCounter");
  const jobIds = Array.from({ length: Number(jobCounter) }, (_, index) => BigInt(index + 1));

  const jobs = await mapWithLimit(jobIds, INDEXER_RPC.CONCURRENCY, (jobId) =>
    withTimeout(readJob(jobId), `readJob(${jobId})`),
  );

  return jobs
    .filter((job): job is NonNullable<typeof job> => job !== null)
    .map((job) => ({
      id: job.id.toString(),
      agentId: job.agentId.toString(),
      client: job.client,
      worker: job.worker,
      evaluator: job.evaluator,
      budget: job.budget.toString(),
      fundedAmount: job.fundedAmount.toString(),
      createdAt: job.createdAt.toString(),
      jobSpecHash: job.jobSpecHash,
      deliverableURI: job.deliverableURI,
      proofMetadataURI: job.proofMetadataURI,
      approved: job.approved,
      status: job.status,
    }));
}

export async function buildJobDetailProjection(jobId: bigint) {
  const job = await withTimeout(readJob(jobId), `readJob(${jobId})`).then((record) => ({
    id: record.id.toString(),
    agentId: record.agentId.toString(),
    client: record.client,
    worker: record.worker,
    evaluator: record.evaluator,
    budget: record.budget.toString(),
    fundedAmount: record.fundedAmount.toString(),
    createdAt: record.createdAt.toString(),
    jobSpecHash: record.jobSpecHash,
    deliverableURI: record.deliverableURI,
    proofMetadataURI: record.proofMetadataURI,
    approved: record.approved,
    status: record.status,
  })).catch(() => null);

  if (!job) return null;

  const tokenId = await withTimeout(readWorkProofTokenByJobId(jobId), `readWorkProofTokenByJobId(${jobId})`).catch(() => BigInt(0));
  const proof =
    tokenId > BigInt(0)
      ? await withTimeout(readWorkProof(tokenId), `readWorkProof(${tokenId})`).then((record) => ({
          tokenId: tokenId.toString(),
          jobId: record.jobId.toString(),
          agentId: record.agentId.toString(),
          payer: record.payer,
          amountPaid: record.amountPaid.toString(),
          mintedAt: record.mintedAt.toString(),
          metadataURI: record.metadataURI,
        })).catch(() => null)
      : null;

  return {
    job,
    proof,
  };
}

export async function buildAgentsProjection(registeredAgentIds: bigint[] = []) {
  // If caller passes IDs, refresh ONLY those agents. Full scan is retained only
  // for manual/legacy callers that pass no IDs.
  const fromRegistry = registeredAgentIds.map((id) => id.toString());
  const fromJobs = registeredAgentIds.length > 0
    ? []
    : (await readAllJobs().catch(() => [])).map((job) => job.agentId.toString());
  const uniqueAgentIds = Array.from(new Set([...fromRegistry, ...fromJobs])).map((id) => BigInt(id));

  const profiles = await mapWithLimit(uniqueAgentIds, INDEXER_RPC.CONCURRENCY, (agentId) =>
    withTimeout(readAgentProfile(agentId), `readAgentProfile(${agentId})`),
  );

  return profiles
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((profile) => ({
      agentId: profile.agent.agentId.toString(),
      controller: profile.agent.controller,
      skillHash: profile.agent.skillHash,
      metadataURI: profile.agent.metadataURI,
      registeredAt: profile.agent.registeredAt.toString(),
      reputationScore: profile.agent.reputationScore.toString(),
      score: profile.score.toString(),
      jobs: profile.jobs.map((job) => job.id.toString()),
      proofTokenIds: profile.proofTokenIds.map((tokenId) => tokenId.toString()),
    }));
}

export async function buildAgentDetailProjection(agentId: bigint, registeredAgentIds: bigint[] = []) {
  const profiles = await buildAgentsProjection(registeredAgentIds);
  const profile = profiles.find((entry) => entry.agentId === agentId.toString());

  if (!profile) {
    return null;
  }

  const jobs = await buildJobsProjection();
  const proofs = await buildProofsProjection();

  return {
    agent: profile,
    jobs: jobs.filter((job) => job.agentId === agentId.toString()),
    proofs: proofs.filter((proof) => proof.agentId === agentId.toString()),
  };
}

export async function buildProofsProjection() {
  const jobs = await buildJobsProjection();
  const proofs = await mapWithLimit(jobs, INDEXER_RPC.CONCURRENCY, async (job) => {
    const tokenId = await withTimeout(readWorkProofTokenByJobId(BigInt(job.id)), `readWorkProofTokenByJobId(${job.id})`);
    if (tokenId === BigInt(0)) return null;
    const proof = await withTimeout(readWorkProof(tokenId), `readWorkProof(${tokenId})`);
    return {
      tokenId: tokenId.toString(),
      jobId: proof.jobId.toString(),
      agentId: proof.agentId.toString(),
      payer: proof.payer,
      amountPaid: proof.amountPaid.toString(),
      mintedAt: proof.mintedAt.toString(),
      metadataURI: proof.metadataURI,
    };
  });

  return proofs.filter((proof): proof is NonNullable<typeof proof> => proof !== null);
}

export async function buildOverviewProjection(events: IndexedJobEvent[]) {
  const [jobs, agents, proofs] = await Promise.all([
    buildJobsProjection(),
    buildAgentsProjection(),
    buildProofsProjection(),
  ]);

  const totalBudget = jobs.reduce((sum, job) => sum + BigInt(job.budget), BigInt(0));
  const totalFunded = jobs.reduce((sum, job) => sum + BigInt(job.fundedAmount), BigInt(0));
  const settledJobs = jobs.filter((job) => job.status === 5).length;
  const fundedJobs = jobs.filter((job) => BigInt(job.fundedAmount) > BigInt(0)).length;

  return {
    summary: {
      eventCount: events.length,
      jobs: jobs.length,
      agents: agents.length,
      proofs: proofs.length,
      totalBudget: totalBudget.toString(),
      totalFunded: totalFunded.toString(),
      settledJobs,
      fundedJobs,
    },
    jobs,
    agents,
    proofs,
  };
}
