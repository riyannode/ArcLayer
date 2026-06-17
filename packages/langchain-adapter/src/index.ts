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
} from "./types.js";
