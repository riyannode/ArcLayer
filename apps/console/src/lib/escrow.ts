/**
 * escrow.ts — Human-to-Agent Vault / future custom module compatibility shim.
 *
 * Pure Arc reference mode uses ERC-8183 AgenticCommerce for job lifecycle
 * in production reference mode. This file exists only to
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
