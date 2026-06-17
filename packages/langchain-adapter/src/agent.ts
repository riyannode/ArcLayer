/**
 * @arclayer/langchain-adapter — Agent factory.
 *
 * Creates a LangChain agent pre-configured with ArcLayer tools and system prompt.
 */

import { createAgent } from "langchain";
import { createArcLayerLangChainTools } from "./tools.js";
import { buildArcLayerSystemPrompt } from "./prompts.js";
import type { CreateArcLayerLangChainAgentOptions } from "./types.js";

/**
 * Create a LangChain agent with ArcLayer tools and role-scoped system prompt.
 *
 * @example
 * ```ts
 * import { createArcLayerLangChainAgent } from "@arclayer/langchain-adapter";
 *
 * const agent = createArcLayerLangChainAgent({
 *   role: "x402-agent",
 *   model: "openai:gpt-4o",
 *   runnerUrl: "http://127.0.0.1:8787",
 *   runnerSecret: process.env.ARCLAYER_RUNNER_SECRET!,
 *   maxAmountUsdc: "0.001",
 *   allowedHosts: ["arclayers.xyz"],
 * });
 *
 * const result = await agent.invoke({
 *   messages: [{ role: "user", content: "Inspect https://arclayers.xyz/api/x402/protected-resource" }],
 * });
 * ```
 */
export function createArcLayerLangChainAgent(
  options: CreateArcLayerLangChainAgentOptions,
) {
  const {
    model,
    systemPrompt,
    role = "read-only",
    ...toolOptions
  } = options;

  const tools = createArcLayerLangChainTools(toolOptions);
  const prompt = buildArcLayerSystemPrompt(role, systemPrompt);

  return createAgent({
    model: model as Parameters<typeof createAgent>[0]["model"],
    tools,
    systemPrompt: prompt,
  });
}
