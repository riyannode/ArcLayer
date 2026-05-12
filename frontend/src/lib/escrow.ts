import { CONTRACTS, ZERO_ADDRESS } from '@arclayer/sdk';

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
} from '@arclayer/sdk';

export const ESCROW_CONFIGURED = (CONTRACTS.MILESTONE_ESCROW as string) !== ZERO_ADDRESS;
export { ZERO_ADDRESS };
