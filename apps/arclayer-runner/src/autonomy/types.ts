/**
 * Shared types for autonomy workers.
 */
import type {
  AutonomyConfig,
  CircleConfig,
  RuntimeConfig,
  NetworkConfig,
} from "@arclayer/runner-core";

// ── Worker Role ────────────────────────────────────────────────────────

export type AutonomyRole = "client" | "provider" | "evaluator" | "x402-agent";

// ── Workflow States ────────────────────────────────────────────────────

/** Client workflow states */
export const CLIENT_STATES = [
  "RECEIVED",
  "VALIDATING",
  "CREATING_JOB",
  "JOB_CREATED",
  "SETTING_BUDGET",
  "BUDGET_SET",
  "APPROVING_USDC",
  "USDC_APPROVED",
  "FUNDING",
  "FUNDED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
] as const;
export type ClientState = (typeof CLIENT_STATES)[number];

/** Provider workflow states */
export const PROVIDER_STATES = [
  "DISCOVERED",
  "VERIFYING",
  "EXECUTION_STARTED",
  "RUNTIME_RUNNING",
  "PAYMENT_REQUIRED",
  "PAYING",
  "RESUMING_RUNTIME",
  "DELIVERABLE_READY",
  "PUBLISHING_DELIVERABLE",
  "DELIVERABLE_PUBLISHED",
  "SUBMITTING",
  "SUBMITTED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "TERMINAL_EXTERNAL",
] as const;
export type ProviderState = (typeof PROVIDER_STATES)[number];

/** Evaluator workflow states */
export const EVALUATOR_STATES = [
  "DISCOVERED",
  "VERIFYING",
  "FETCHING_DELIVERABLE",
  "DELIVERABLE_VERIFIED",
  "EVALUATION_RUNNING",
  "VERDICT_READY",
  "COMPLETING",
  "REJECTING",
  "COMPLETED",
  "REJECTED",
  "MANUAL_REVIEW",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "TERMINAL_EXTERNAL",
] as const;
export type EvaluatorState = (typeof EVALUATOR_STATES)[number];

export type WorkflowState = ClientState | ProviderState | EvaluatorState;

// ── Workflow Record ────────────────────────────────────────────────────

export type AutonomyWorkflow = {
  id: string;
  kind: string;
  role: AutonomyRole;
  requestId?: string;
  jobId?: string;
  state: WorkflowState;
  payload: unknown;
  result?: unknown;
  errorCode?: string;
  errorMessage?: string;
  attempts: number;
  nextRunAt?: string;
  leaseOwner?: string;
  leaseUntil?: string;
  createdAt: string;
  updatedAt: string;
};

// ── Event Record ───────────────────────────────────────────────────────

export type AutonomyEvent = {
  id: string;
  workflowId: string;
  jobId?: string;
  role: AutonomyRole;
  eventType: string;
  payload: unknown;
  createdAt: string;
};

// ── State Transition Map ───────────────────────────────────────────────

type TransitionMap = Record<string, readonly string[]>;

export const CLIENT_TRANSITIONS: TransitionMap = {
  RECEIVED: ["VALIDATING", "FAILED_FINAL"],
  VALIDATING: ["CREATING_JOB", "FAILED_RETRYABLE", "FAILED_FINAL"],
  CREATING_JOB: ["JOB_CREATED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  JOB_CREATED: ["SETTING_BUDGET", "FAILED_RETRYABLE", "FAILED_FINAL"],
  SETTING_BUDGET: ["BUDGET_SET", "FAILED_RETRYABLE", "FAILED_FINAL"],
  BUDGET_SET: ["APPROVING_USDC", "FAILED_RETRYABLE", "FAILED_FINAL"],
  APPROVING_USDC: ["USDC_APPROVED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  USDC_APPROVED: ["FUNDING", "FAILED_RETRYABLE", "FAILED_FINAL"],
  FUNDING: ["FUNDED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  FUNDED: [],
  FAILED_RETRYABLE: ["RECEIVED", "FAILED_FINAL"],
  FAILED_FINAL: [],
};

export const PROVIDER_TRANSITIONS: TransitionMap = {
  DISCOVERED: ["VERIFYING", "TERMINAL_EXTERNAL", "FAILED_FINAL"],
  VERIFYING: ["EXECUTION_STARTED", "TERMINAL_EXTERNAL", "FAILED_RETRYABLE", "FAILED_FINAL"],
  EXECUTION_STARTED: ["RUNTIME_RUNNING", "PAYMENT_REQUIRED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  RUNTIME_RUNNING: ["DELIVERABLE_READY", "PAYMENT_REQUIRED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  PAYMENT_REQUIRED: ["PAYING", "FAILED_RETRYABLE", "FAILED_FINAL"],
  PAYING: ["RESUMING_RUNTIME", "FAILED_RETRYABLE", "FAILED_FINAL"],
  RESUMING_RUNTIME: ["DELIVERABLE_READY", "PAYMENT_REQUIRED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  DELIVERABLE_READY: ["PUBLISHING_DELIVERABLE", "FAILED_RETRYABLE", "FAILED_FINAL"],
  PUBLISHING_DELIVERABLE: ["DELIVERABLE_PUBLISHED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  DELIVERABLE_PUBLISHED: ["SUBMITTING", "FAILED_RETRYABLE", "FAILED_FINAL"],
  SUBMITTING: ["SUBMITTED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  SUBMITTED: [],
  FAILED_RETRYABLE: ["DISCOVERED", "VERIFYING", "EXECUTION_STARTED", "FAILED_FINAL"],
  FAILED_FINAL: [],
  TERMINAL_EXTERNAL: [],
};

export const EVALUATOR_TRANSITIONS: TransitionMap = {
  DISCOVERED: ["VERIFYING", "TERMINAL_EXTERNAL", "FAILED_FINAL"],
  VERIFYING: ["FETCHING_DELIVERABLE", "TERMINAL_EXTERNAL", "FAILED_RETRYABLE", "FAILED_FINAL"],
  FETCHING_DELIVERABLE: ["DELIVERABLE_VERIFIED", "MANUAL_REVIEW", "FAILED_RETRYABLE", "FAILED_FINAL"],
  DELIVERABLE_VERIFIED: ["EVALUATION_RUNNING", "FAILED_RETRYABLE", "FAILED_FINAL"],
  EVALUATION_RUNNING: ["VERDICT_READY", "MANUAL_REVIEW", "FAILED_RETRYABLE", "FAILED_FINAL"],
  VERDICT_READY: ["COMPLETING", "REJECTING", "MANUAL_REVIEW", "FAILED_FINAL"],
  COMPLETING: ["COMPLETED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  REJECTING: ["REJECTED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  COMPLETED: [],
  REJECTED: [],
  MANUAL_REVIEW: [],
  FAILED_RETRYABLE: ["DISCOVERED", "VERIFYING", "FETCHING_DELIVERABLE", "FAILED_FINAL"],
  FAILED_FINAL: [],
  TERMINAL_EXTERNAL: [],
};

/**
 * Assert that a state transition is legal. Throws if illegal.
 */
export function assertStateTransition(
  role: AutonomyRole,
  from: WorkflowState,
  to: WorkflowState
): void {
  const map =
    role === "client" ? CLIENT_TRANSITIONS :
    role === "provider" ? PROVIDER_TRANSITIONS :
    role === "evaluator" ? EVALUATOR_TRANSITIONS :
    null;

  if (!map) {
    throw new Error(`No transition map for role: ${role}`);
  }

  const allowed = map[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `Illegal state transition for ${role}: ${from} → ${to}. ` +
      `Allowed: ${allowed?.join(", ") ?? "none (terminal state)"}`
    );
  }
}

// ── Worker Health ──────────────────────────────────────────────────────

export type WorkerHealth = {
  enabled: boolean;
  role: AutonomyRole;
  workerState: "starting" | "running" | "stopping" | "stopped" | "error";
  activeWorkflows: number;
  lastPollAt: string | null;
  lastError: string | null;
};
