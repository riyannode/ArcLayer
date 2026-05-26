/**
 * ERC-8183 participant-bound authorization.
 *
 * Every ERC-8183 mutation route must verify that the authenticated
 * API key's agentId matches the expected participant role for the action.
 *
 * Scope alone is insufficient — a leaked erc8183:claim key must not
 * be able to claim jobs for another providerAgentId.
 */

import type { VerifiedKey } from '@/lib/a2a/auth';
import type { Erc8183JobView } from './types';
import { NextResponse } from 'next/server';
import { escrowRail } from '@/lib/rails/responses';

export type Erc8183Role =
  | 'buyer'
  | 'provider'
  | 'worker'
  | 'evaluator'
  | 'admin';

/**
 * Check if the authenticated key has admin-level ERC-8183 scope.
 * Admin overrides participant checking.
 */
export function isErc8183Admin(scopes: string[]): boolean {
  return scopes.includes('admin') || scopes.includes('erc8183:admin');
}

/**
 * Collect all allowed agent IDs for the given roles on a job.
 */
export function allowedErc8183AgentIds(
  job: Erc8183JobView,
  roles: Erc8183Role[],
): Set<string> {
  const ids = new Set<string>();

  if (roles.includes('buyer') && job.buyerAgentId) {
    ids.add(job.buyerAgentId);
  }
  if (roles.includes('provider') && job.providerAgentId) {
    ids.add(job.providerAgentId);
  }
  if (roles.includes('worker') && job.workerId) {
    ids.add(job.workerId);
  }
  if (roles.includes('evaluator') && job.evaluatorAgentId) {
    ids.add(job.evaluatorAgentId);
  }

  return ids;
}

/**
 * 403 response for participant mismatch.
 */
export function participantMismatchResponse(
  auth: { key: VerifiedKey },
  roles: Erc8183Role[],
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      ...escrowRail(),
      error: 'participant_mismatch',
      expectedRoles: roles,
      authenticatedAgentId: auth.key.agentId,
      hint: `This action requires one of these roles: ${roles.join(', ')}. Your agentId (${auth.key.agentId}) is not authorized for this job.`,
    },
    { status: 403 },
  );
}

/**
 * Assert that the authenticated key is a valid participant for the given roles.
 *
 * Admin keys (with 'admin' or 'erc8183:admin' scope) bypass participant checking.
 * Returns a NextResponse error if mismatch, or null if allowed.
 */
export function assertErc8183Participant(
  job: Erc8183JobView,
  auth: { key: VerifiedKey },
  roles: Erc8183Role[],
): NextResponse | null {
  if (isErc8183Admin(auth.key.scopes)) return null;

  const allowed = allowedErc8183AgentIds(job, roles);
  if (!allowed.has(auth.key.agentId)) {
    return participantMismatchResponse(auth, roles);
  }

  return null;
}
