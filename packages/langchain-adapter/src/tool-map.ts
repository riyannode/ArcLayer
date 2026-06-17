/**
 * @arclayer/langchain-adapter — Tool name mapping.
 *
 * Maps SDK-friendly LangChain tool names to Runner HTTP paths and MCP names.
 * MCP names are internal; LangChain names use arclayer_ prefix + snake_case.
 *
 * Tools with adapterOnly: true are handled entirely by the adapter —
 * they do not make Runner HTTP calls.
 */

import type { ToolMapEntry } from "./types.js";

export const TOOL_NAME_MAP: Record<string, ToolMapEntry> = {
  arclayer_x402_inspect: {
    runnerPath: "/x402/inspect",
    method: "POST",
    mcpName: "x402.inspect",
    risk: "read",
  },
  arclayer_x402_pay: {
    runnerPath: "/x402/pay",
    method: "POST",
    mcpName: "x402.pay",
    risk: "payment",
  },
  arclayer_x402_batch_pay: {
    runnerPath: "/x402/batch-pay",
    method: "POST",
    mcpName: "x402.batch_pay",
    risk: "payment",
  },
  arclayer_receipts: {
    runnerPath: "/receipts",
    method: "GET",
    mcpName: "x402.list_receipts",
    risk: "read",
  },
  arclayer_spend_ledger: {
    runnerPath: "/ledger",
    method: "GET",
    mcpName: "runner.ledger",
    risk: "read",
  },
  arclayer_provider_run_only: {
    runnerPath: "/erc8183/provider/run-only",
    method: "POST",
    mcpName: "erc8183.provider_run_job",
    risk: "write",
  },
  arclayer_provider_run_and_submit: {
    runnerPath: "/erc8183/provider/run-and-submit",
    method: "POST",
    mcpName: "erc8183.provider_run_and_submit",
    risk: "write",
  },
  arclayer_provider_quote_job: {
    runnerPath: "",
    method: "POST",
    mcpName: "erc8183.provider_quote_job",
    risk: "read",
    adapterOnly: true,
  },
  arclayer_provider_set_budget: {
    runnerPath: "/erc8183/provider/set-budget",
    method: "POST",
    mcpName: "erc8183.provider_set_budget",
    risk: "write",
  },
};

/**
 * Get all registered tool names.
 */
export function getAllToolNames(): string[] {
  return Object.keys(TOOL_NAME_MAP);
}

/**
 * Get tool entry by LangChain tool name.
 */
export function getToolEntry(
  name: string,
): ToolMapEntry | undefined {
  return TOOL_NAME_MAP[name];
}
