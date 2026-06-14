/**
 * ArcLayer Runner — Console MCP Proxy
 *
 * Proxies selected Console MCP tools through the Runner.
 * Only allowlisted tools are forwarded. Rejects everything else.
 *
 * Error handling: throws RunnerError on failure so the executor's
 * error path (sanitizer + isError + broker.recordFailure) is used.
 *
 * Security rules:
 * - Reject non-allowlisted tool names
 * - Do not expose filesystem/shell/env/network tools
 * - Do not sign transactions
 * - Do not ask for private keys
 * - Return prepared calldata / structured response only
 */

import { isProxyToolAllowed } from "./tool-registry";
import type { ArcLayerMcpConnector } from "./mcp-connector";
import { RunnerError } from "@arclayer/runner-core";

/**
 * Proxy a tool call to Console MCP.
 * Throws RunnerError if the tool is not allowed or the upstream call fails.
 * On success, returns the upstream result directly.
 *
 * @param timeoutMs - Optional timeout for the SDK client callTool.
 */
export async function proxyToConsoleMcp(
  toolName: string,
  args: Record<string, unknown>,
  mcp: ArcLayerMcpConnector,
  timeoutMs?: number,
): Promise<unknown> {
  if (!isProxyToolAllowed(toolName)) {
    throw new RunnerError(
      'MCP_PROXY_NOT_ALLOWED',
      `Tool '${toolName}' is not in the Console MCP proxy allowlist`,
      403,
    );
  }

  // Let errors propagate to the executor's error handler
  return mcp.callTool(toolName, args, timeoutMs);
}

/**
 * Get list of all allowlisted proxy tool names.
 */
export function getProxyAllowlist(): string[] {
  const { CONSOLE_MCP_PROXY_TOOLS } = require("./tool-registry");
  return CONSOLE_MCP_PROXY_TOOLS
    .filter((t: any) => t.status === "active")
    .map((t: any) => t.name);
}
