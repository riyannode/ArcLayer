/**
 * escrow.ts — DEPRECATED legacy MilestoneEscrow shim.
 *
 * Pure Arc reference mode uses ERC-8183 AgenticCommerce for job lifecycle
 * instead of a custom MilestoneEscrow contract. This file exists only to
 * keep import paths from breaking; all values are inert.
 */

import { ZERO_ADDRESS, publicClient } from '@arclayer/sdk';

export type MilestoneTuple = readonly unknown[];
export type ProjectTuple = readonly unknown[];

export const ESCROW_CONFIGURED = false;
export { ZERO_ADDRESS, publicClient };

export const milestoneEscrow = null;

export function milestoneFromTuple(_tuple: unknown): null {
  return null;
}
export function projectFromTuple(_tuple: unknown): null {
  return null;
}
export async function readProject(_id: bigint): Promise<null> {
  return null;
}
export async function readProjectMilestones(_id: bigint): Promise<MilestoneTuple[]> {
  return [];
}
export async function readUserProjects(_user: `0x${string}`): Promise<bigint[]> {
  return [];
}
