// ── Operation State Machine ─────────────────────────────────────────────
// Phase 4A: types + state machine only. No SQLite, no ExecutionGateway,
// no locks, no persistence. Pure foundation for Phase 4 write operations.

import { RunnerError } from "./errors";

// ── Operation States ───────────────────────────────────────────────────

export const OPERATION_STATES = [
  "created",
  "prepared",
  "reserved",
  "executing",
  "broadcast",
  "confirmed",
  "failed",
  "unknown",
  "cancelled",
] as const;

export type OperationState = (typeof OPERATION_STATES)[number];

// ── Terminal State Detection ───────────────────────────────────────────

const TERMINAL_STATES: ReadonlySet<OperationState> = new Set([
  "confirmed",
  "failed",
  "cancelled",
]);

/** Returns true if the state is terminal (no further transitions allowed). */
export function isTerminalOperationState(state: OperationState): boolean {
  return TERMINAL_STATES.has(state);
}

// ── Allowed Transitions ────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: ReadonlyMap<OperationState, ReadonlySet<OperationState>> =
  new Map([
    ["created", new Set(["prepared", "failed", "cancelled"])],
    ["prepared", new Set(["reserved", "failed"])],
    ["reserved", new Set(["executing", "failed"])],
    ["executing", new Set(["broadcast", "unknown", "failed", "cancelled"])],
    ["broadcast", new Set(["confirmed", "unknown", "failed"])],
    ["unknown", new Set(["confirmed", "failed"])],
    // Terminal states have no outgoing transitions
    ["confirmed", new Set()],
    ["failed", new Set()],
    ["cancelled", new Set()],
  ]);

/** Returns true if the from→to transition is allowed. */
export function canTransitionOperationState(
  from: OperationState,
  to: OperationState
): boolean {
  const targets = ALLOWED_TRANSITIONS.get(from);
  if (!targets) return false;
  return targets.has(to);
}

// ── Operation Error Codes ──────────────────────────────────────────────

export const OPERATION_ERROR_CODES = [
  "INVALID_TRANSITION",
  "IDEMPOTENCY_CONFLICT",
  "LOCK_CONFLICT",
  "BROADCAST_FAILED",
  "CONFIRMATION_TIMEOUT",
  "RECONCILIATION_REQUIRED",
  "UNKNOWN_TX_STATE",
  "OPERATION_CANCELLED",
  "UNSUPPORTED_CHAIN",
] as const;

export type OperationErrorCode = (typeof OPERATION_ERROR_CODES)[number];

// ── Transition Assertion ───────────────────────────────────────────────

/**
 * Assert that a state transition is valid. Throws RunnerError with
 * INVALID_TRANSITION code if the transition is not allowed.
 */
export function assertOperationStateTransition(
  from: OperationState,
  to: OperationState
): void {
  if (!canTransitionOperationState(from, to)) {
    throw new RunnerError(
      "INVALID_TRANSITION" satisfies OperationErrorCode,
      `Invalid operation state transition: ${from} → ${to}`,
      422,
      { from, to }
    );
  }
}

// ── Operation Record ───────────────────────────────────────────────────

export type OperationRecord = {
  operationId: string;
  idempotencyKey: string;
  toolName: string;
  actor?: string;
  role?: string;
  agentId?: string;
  walletAddress?: string;
  chainId?: number;
  contractAddress?: string;
  method?: string;
  paramsHash: string;
  amount?: string;
  state: OperationState;
  txHash?: string;
  receiptHash?: string;
  errorCode?: OperationErrorCode;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};
