/**
 * Autonomy module — autonomous ERC-8183 lifecycle workers.
 */
export { AutonomyStore } from "./autonomy-store";
export { TransactionReconciler, type ReconciliationResult } from "./transaction-reconciler";
export { ClientOrchestrator, type ClientCreateAndFundInput, type ClientCreateAndFundOutput } from "./client-orchestrator";
export {
  type AutonomyRole,
  type AutonomyWorkflow,
  type AutonomyEvent,
  type WorkflowState,
  type WorkerHealth,
  type ClientState,
  type ProviderState,
  type EvaluatorState,
  CLIENT_STATES,
  PROVIDER_STATES,
  EVALUATOR_STATES,
  CLIENT_TRANSITIONS,
  PROVIDER_TRANSITIONS,
  EVALUATOR_TRANSITIONS,
  assertStateTransition,
} from "./types";
