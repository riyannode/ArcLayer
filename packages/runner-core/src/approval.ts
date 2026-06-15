/**
 * Client Approval — types, state machine constants, and request hash.
 *
 * SQLite store lives in apps/arclayer-runner/src/approval-store.ts
 * (better-sqlite3 is a runner dependency, not runner-core).
 */

import { createHash } from "node:crypto";

// ── Types ──────────────────────────────────────────────────────────────────

export type ApprovalState =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "executing"
  | "executed"
  | "failed";

export type ApprovalActionType =
  | "createJob"
  | "approveUsdc"
  | "fundJob"
  | "claimRefund";

export type ApprovalRecord = {
  approvalId: string;
  actionType: ApprovalActionType;
  role: string;
  walletAddress: string;
  chainId: number;
  jobId: string | null;
  amount: string | null;
  requestHash: string;
  idempotencyKey: string;
  state: ApprovalState;
  paramsJson: string;
  txHash: string | null;
  resultJson: string | null;
  operationId: string | null;
  errorMessage: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateApprovalInput = {
  actionType: ApprovalActionType;
  role: string;
  walletAddress: string;
  chainId: number;
  jobId?: string;
  amount?: string;
  requestHash: string;
  idempotencyKey: string;
  params: Record<string, unknown>;
  expiresAt: string;
};

export type TransitionResult =
  | { ok: true; approval: ApprovalRecord }
  | { ok: false; error: string; current: ApprovalRecord };

// ── Allowed transitions ────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<ApprovalState, ApprovalState[]> = {
  pending:   ["approved", "rejected", "cancelled", "expired", "executing"],
  approved:  [],  // deprecated path — kept for schema compat
  executing: ["executed", "failed"],
  executed:  [],
  failed:    [],
  rejected:  [],
  cancelled: [],
  expired:   [],
};

export function isTransitionAllowed(from: ApprovalState, to: ApprovalState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Request Hash ───────────────────────────────────────────────────────────

/**
 * Compute deterministic request hash for an approval action.
 * Uses SHA-256 of canonical JSON with sorted keys.
 */
export function computeRequestHash(params: Record<string, unknown>): string {
  const sorted = sortKeysRecursive(params);
  const canonical = JSON.stringify(sorted);
  return createHash("sha256").update(canonical).digest("hex");
}

function sortKeysRecursive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeysRecursive);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeysRecursive((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}
