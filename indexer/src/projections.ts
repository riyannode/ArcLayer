import { readAgentProfile, readAllJobs, readWorkProof, readWorkProofTokenByJobId } from "@arcwork/sdk";
import type { IndexedJobEvent } from "@arcwork/sdk";

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
  const jobs = await readAllJobs();
  return jobs.map((job) => ({
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
  const jobs = await buildJobsProjection();
  const job = jobs.find((entry) => entry.id === jobId.toString());

  if (!job) {
    return null;
  }

  const tokenId = await readWorkProofTokenByJobId(jobId);
  const proof =
    tokenId > BigInt(0)
      ? await readWorkProof(tokenId).then((record) => ({
          tokenId: tokenId.toString(),
          jobId: record.jobId.toString(),
          agentId: record.agentId.toString(),
          payer: record.payer,
          amountPaid: record.amountPaid.toString(),
          mintedAt: record.mintedAt.toString(),
          metadataURI: record.metadataURI,
        }))
      : null;

  return {
    job,
    proof,
  };
}

export async function buildAgentsProjection() {
  const jobs = await readAllJobs();
  const uniqueAgentIds = Array.from(new Set(jobs.map((job) => job.agentId.toString()))).map((id) => BigInt(id));
  const profiles = await Promise.all(uniqueAgentIds.map((agentId) => readAgentProfile(agentId)));

  return profiles.map((profile) => ({
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

export async function buildAgentDetailProjection(agentId: bigint) {
  const profiles = await buildAgentsProjection();
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
  const jobs = await readAllJobs();
  const proofs = await Promise.all(
    jobs.map(async (job) => {
      const tokenId = await readWorkProofTokenByJobId(job.id);
      if (tokenId === BigInt(0)) return null;
      const proof = await readWorkProof(tokenId);
      return {
        tokenId: tokenId.toString(),
        jobId: proof.jobId.toString(),
        agentId: proof.agentId.toString(),
        payer: proof.payer,
        amountPaid: proof.amountPaid.toString(),
        mintedAt: proof.mintedAt.toString(),
        metadataURI: proof.metadataURI,
      };
    })
  );

  return proofs.filter(Boolean);
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
