import type { Address } from "viem";
import { agentRegistry, jobEscrow, milestoneEscrow, reputationOracle, workProof } from "./chain";
import type {
  AgentRecordTuple,
  JobTuple,
  MilestoneTuple,
  ProjectTuple,
  WorkProofTuple,
} from "./types";

export function projectFromTuple(project: ProjectTuple) {
  return {
    id: project[0],
    freelancer: project[1],
    client: project[2],
    totalAmount: project[3],
    releasedAmount: project[4],
    createdAt: project[5],
    milestoneCount: Number(project[6]),
    title: project[7],
    description: project[8],
    status: project[9],
  };
}

export function milestoneFromTuple(milestone: MilestoneTuple) {
  return {
    id: milestone[0],
    projectId: milestone[1],
    amount: milestone[2],
    submittedAt: milestone[3],
    releasedAt: milestone[4],
    title: milestone[5],
    deliverableURI: milestone[6],
    status: milestone[7],
  };
}

export function agentFromTuple(agent: AgentRecordTuple) {
  return {
    agentId: agent[0],
    skillHash: agent[1],
    metadataURI: agent[2],
    controller: agent[3],
    registeredAt: agent[4],
    reputationScore: agent[5],
    exists: agent[6],
  };
}

export function agentFromRecord(
  agent: {
    agentId: bigint;
    skillHash: `0x${string}`;
    metadataURI: string;
    controller: Address;
    registeredAt: bigint;
    reputationScore: bigint;
    exists: boolean;
  }
) {
  return {
    agentId: agent.agentId,
    skillHash: agent.skillHash,
    metadataURI: agent.metadataURI,
    controller: agent.controller,
    registeredAt: agent.registeredAt,
    reputationScore: agent.reputationScore,
    exists: agent.exists,
  };
}

export function jobFromTuple(job: JobTuple) {
  return {
    id: job[0],
    agentId: job[1],
    client: job[2],
    worker: job[3],
    evaluator: job[4],
    budget: job[5],
    fundedAmount: job[6],
    createdAt: job[7],
    jobSpecHash: job[8],
    deliverableURI: job[9],
    proofMetadataURI: job[10],
    approved: job[11],
    status: job[12],
  };
}

export function jobFromRecord(
  job: {
    id: bigint;
    agentId: bigint;
    client: Address;
    worker: Address;
    evaluator: Address;
    budget: bigint;
    fundedAmount: bigint;
    createdAt: bigint;
    jobSpecHash: `0x${string}`;
    deliverableURI: string;
    proofMetadataURI: string;
    approved: boolean;
    status: number;
  }
) {
  return {
    id: job.id,
    agentId: job.agentId,
    client: job.client,
    worker: job.worker,
    evaluator: job.evaluator,
    budget: job.budget,
    fundedAmount: job.fundedAmount,
    createdAt: job.createdAt,
    jobSpecHash: job.jobSpecHash,
    deliverableURI: job.deliverableURI,
    proofMetadataURI: job.proofMetadataURI,
    approved: job.approved,
    status: job.status,
  };
}

export function workProofFromTuple(proof: WorkProofTuple) {
  return {
    jobId: proof[0],
    agentId: proof[1],
    payer: proof[2],
    amountPaid: proof[3],
    mintedAt: proof[4],
    metadataURI: proof[5],
  };
}

export function workProofFromRecord(
  proof: {
    jobId: bigint;
    agentId: bigint;
    payer: Address;
    amountPaid: bigint;
    mintedAt: bigint;
    metadataURI: string;
  }
) {
  return {
    jobId: proof.jobId,
    agentId: proof.agentId,
    payer: proof.payer,
    amountPaid: proof.amountPaid,
    mintedAt: proof.mintedAt,
    metadataURI: proof.metadataURI,
  };
}

export async function readProject(projectId: bigint) {
  const project = await milestoneEscrow.read.projects([projectId]);
  return projectFromTuple(project as ProjectTuple);
}

export async function readProjectMilestones(projectId: bigint, milestoneCount: number) {
  const reads = Array.from({ length: milestoneCount }, (_, milestoneId) =>
    milestoneEscrow.read.milestones([projectId, BigInt(milestoneId)])
  );
  const milestones = await Promise.all(reads);
  return milestones.map((milestone) => milestoneFromTuple(milestone as MilestoneTuple));
}

export async function readUserProjects(user: Address) {
  return milestoneEscrow.read.getUserProjects([user]);
}

export async function readAgent(agentId: bigint) {
  const agent = await agentRegistry.read.getAgent([agentId]);
  if (agent && typeof agent === "object" && "agentId" in agent) {
    return agentFromRecord(
      agent as unknown as {
        agentId: bigint;
        skillHash: `0x${string}`;
        metadataURI: string;
        controller: Address;
        registeredAt: bigint;
        reputationScore: bigint;
        exists: boolean;
      }
    );
  }
  return agentFromTuple(agent as unknown as AgentRecordTuple);
}

export async function agentExists(agentId: bigint) {
  return agentRegistry.read.exists([agentId]);
}

export async function readJob(jobId: bigint) {
  const job = await jobEscrow.read.jobs([jobId]);
  if (job && typeof job === "object" && "id" in job) {
    return jobFromRecord(
      job as unknown as {
        id: bigint;
        agentId: bigint;
        client: Address;
        worker: Address;
        evaluator: Address;
        budget: bigint;
        fundedAmount: bigint;
        createdAt: bigint;
        jobSpecHash: `0x${string}`;
        deliverableURI: string;
        proofMetadataURI: string;
        approved: boolean;
        status: number;
      }
    );
  }
  return jobFromTuple(job as unknown as JobTuple);
}

export async function readJobCounter() {
  return jobEscrow.read.jobCounter();
}

export async function readUserJobs(user: Address) {
  return jobEscrow.read.getUserJobs([user]);
}

export async function readJobsByAgentId(agentId: bigint) {
  return jobEscrow.read.getJobsByAgentId([agentId]);
}

export async function readAgentJobs(agentId: bigint) {
  const jobIds = await readJobsByAgentId(agentId);
  return Promise.all(jobIds.map((jobId) => readJob(jobId)));
}

export async function readAllJobs() {
  const jobCounter = await readJobCounter();
  const jobIds = Array.from({ length: Number(jobCounter) }, (_, index) => BigInt(index + 1));
  return Promise.all(jobIds.map((jobId) => readJob(jobId)));
}

export async function readWorkProofTokenByJobId(jobId: bigint) {
  return workProof.read.proofTokenByJobId([jobId]);
}

export async function readWorkProof(tokenId: bigint) {
  const proof = await workProof.read.getProof([tokenId]);
  if (proof && typeof proof === "object" && "jobId" in proof) {
    return workProofFromRecord(
      proof as unknown as {
        jobId: bigint;
        agentId: bigint;
        payer: Address;
        amountPaid: bigint;
        mintedAt: bigint;
        metadataURI: string;
      }
    );
  }

  return workProofFromTuple(proof as unknown as WorkProofTuple);
}

export async function readWorkProofsByAgent(agentId: bigint) {
  const tokenIds = await workProof.read.getProofsByAgent([agentId]);
  const proofs = await Promise.all(tokenIds.map((tokenId) => readWorkProof(tokenId)));
  return {
    tokenIds,
    proofs,
  };
}

export async function readReputationScore(agentId: bigint) {
  return reputationOracle.read.getScore([agentId]);
}

export async function readAgentProfile(agentId: bigint) {
  const [agent, score, jobs, proofBundle] = await Promise.all([
    readAgent(agentId),
    readReputationScore(agentId),
    readAgentJobs(agentId),
    readWorkProofsByAgent(agentId),
  ]);

  return {
    agent,
    score,
    jobs,
    proofTokenIds: proofBundle.tokenIds,
    proofs: proofBundle.proofs,
  };
}
