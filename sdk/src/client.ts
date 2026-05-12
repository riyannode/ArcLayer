import type { Address } from "viem";
import { milestoneEscrow } from "./chain";
import type { MilestoneTuple, ProjectTuple } from "./types";

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
