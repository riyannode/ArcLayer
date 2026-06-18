/**
 * @arclayer/langchain-adapter — Public API.
 *
 * @example
 * ```ts
 * import {
 *   ArcLayerRunnerClient,
 *   createArcLayerLangChainTools,
 *   createArcLayerLangChainAgent,
 *   getArcLayerToolsForRole,
 * } from "@arclayer/langchain-adapter";
 * ```
 */

export { ArcLayerRunnerClient } from "./client.js";
export { createArcLayerLangChainTools } from "./tools.js";
export { createArcLayerLangChainAgent } from "./agent.js";
export { getArcLayerToolsForRole, listRolePresets } from "./roles.js";
export { buildArcLayerSystemPrompt } from "./prompts.js";
export {
  ArcLayerError,
  ArcLayerRunnerAuthError,
  ArcLayerRunnerTimeoutError,
  ArcLayerRunnerProtocolError,
  ArcLayerPolicyError,
  ArcLayerToolDeniedError,
} from "./errors.js";

export type {
  ArcLayerAgentRole,
  ArcLayerRunnerClientOptions,
  CreateArcLayerLangChainToolsOptions,
  CreateArcLayerLangChainAgentOptions,
  ArcLayerLogger,
  ProviderRunOnlyInput,
  ProviderRunAndSubmitInput,
  ProviderRunOnlyOutput,
  ProviderRunAndSubmitOutput,
  ProviderPricingPolicy,
  ProviderQuoteJobInput,
  ProviderQuoteJobOutput,
  ProviderSetBudgetInput,
  ProviderSetBudgetOutput,
  ProviderProxyInput,
  ProviderSubmitDeliverableInput,
  JobStatusInput,
  JobLifecycleSummaryInput,
} from "./types.js";

export { DEFAULT_PROVIDER_PRICING_POLICY } from "./types.js";
