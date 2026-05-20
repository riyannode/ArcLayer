import type { Address } from "viem";
import { erc8004IdentityRegistry, erc8183AgenticCommerce } from "./chain";

export type ArcAgentRecord = {
  agentId: bigint;
  tokenId: bigint;
  controller: Address;
  metadataURI: string;
  exists: boolean;
};

export type ArcJobRecord = {
  id: bigint;
  client: Address;
  provider: Address;
  evaluator: Address;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  hook: Address;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/**
 * Read official ERC-8004 identity token.
 * ERC-8004 is ERC-721-like: ownerOf(tokenId), tokenURI(tokenId).
 */
export async function readAgent(agentId: bigint): Promise<ArcAgentRecord> {
  const [controller, metadataURI] = await Promise.all([
    erc8004IdentityRegistry.read.ownerOf([agentId]),
    erc8004IdentityRegistry.read.tokenURI([agentId]),
  ]);

  return {
    agentId,
    tokenId: agentId,
    controller,
    metadataURI,
    exists: true,
  };
}

export async function agentExists(agentId: bigint) {
  try {
    await erc8004IdentityRegistry.read.ownerOf([agentId]);
    return true;
  } catch {
    return false;
  }
}

/** Read official ERC-8183 job by ID. */
export async function readJob(jobId: bigint): Promise<ArcJobRecord> {
  const job = await erc8183AgenticCommerce.read.getJob([jobId]);

  if (Array.isArray(job)) {
    return {
      id: job[0],
      client: job[1],
      provider: job[2],
      evaluator: job[3],
      description: job[4],
      budget: job[5],
      expiredAt: job[6],
      status: Number(job[7]),
      hook: job[8],
    };
  }

  const record = job as unknown as ArcJobRecord;
  return {
    id: record.id,
    client: record.client,
    provider: record.provider,
    evaluator: record.evaluator,
    description: record.description,
    budget: record.budget,
    expiredAt: record.expiredAt,
    status: Number(record.status),
    hook: record.hook,
  };
}

/**
 * ERC-8183 reference contract does not expose jobCounter/getUserJobs helpers.
 * Use the indexer for lists.
 */
export async function readJobCounter() {
  throw new Error("ERC-8183 does not expose jobCounter; use the ArcLayer indexer");
}

export async function readUserJobs(_user: Address) {
  return [] as bigint[];
}

export async function readJobsByAgentId(_agentId: bigint) {
  return [] as bigint[];
}

export async function readAgentJobs(agentId: bigint) {
  const jobIds = await readJobsByAgentId(agentId);
  return Promise.all(jobIds.map((jobId) => readJob(jobId)));
}

export async function readAllJobs() {
  return [] as ArcJobRecord[];
}

/** Official Arc/Circle reference mode has no ArcLayer WorkProof contract. */
export async function readWorkProofTokenByJobId(_jobId: bigint) {
  return BigInt(0);
}

export async function readWorkProof(_tokenId: bigint) {
  return null;
}

export async function readWorkProofsByAgent(_agentId: bigint) {
  return { tokenIds: [] as bigint[], proofs: [] as null[] };
}

/** Official Arc/Circle reference mode has no ArcLayer ReputationOracle contract. */
export async function readReputationScore(_agentId: bigint) {
  return BigInt(0);
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

/** @deprecated MilestoneEscrow is disabled in official Arc/Circle reference mode. */
export async function readProject(_projectId: bigint) {
  throw new Error("MilestoneEscrow is disabled in official Arc/Circle reference mode");
}

/** @deprecated MilestoneEscrow is disabled in official Arc/Circle reference mode. */
export async function readProjectMilestones(_projectId: bigint, _milestoneCount: number) {
  return [];
}

/** @deprecated MilestoneEscrow is disabled in official Arc/Circle reference mode. */
export async function readUserProjects(_user: Address) {
  return [] as bigint[];
}


