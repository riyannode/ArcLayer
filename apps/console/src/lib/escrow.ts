import { CONTRACTS, ZERO_ADDRESS } from '@arcwork/sdk';

export {
  milestoneEscrow,
  milestoneFromTuple,
  projectFromTuple,
  publicClient,
  readProject,
  readProjectMilestones,
  readUserProjects,
  type MilestoneTuple,
  type ProjectTuple,
} from '@arcwork/sdk';

export const ESCROW_CONFIGURED = (CONTRACTS.MILESTONE_ESCROW as string) !== ZERO_ADDRESS;
export { ZERO_ADDRESS };
