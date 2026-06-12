/**
 * ArcLayer Runner — Console MCP Proxy
 *
 * Proxies selected Console MCP tools through the Runner.
 * Only allowlisted tools are forwarded. Rejects everything else.
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

// ── Types ─────────────────────────────────────────────────────────────────

export type ProxyResult = {
  ok: boolean;
  proxied: boolean;
  result?: unknown;
  error?: string;
};

// ── Proxy handler ─────────────────────────────────────────────────────────

/**
 * Attempt to proxy a tool call to Console MCP.
 * Returns { proxied: false } if the tool is not in the allowlist,
 * so the caller can try other handlers.
 */
export async function proxyToConsoleMcp(
  toolName: string,
  args: Record<string, unknown>,
  mcp: ArcLayerMcpConnector
): Promise<ProxyResult> {
  // Check allowlist first
  if (!isProxyToolAllowed(toolName)) {
    return { ok: false, proxied: false, error: `Tool '${toolName}' is not in the Console MCP proxy allowlist` };
  }

  try {
    const result = await mcp.callTool(toolName, args);
    return { ok: true, proxied: true, result };
  } catch (error: any) {
    return {
      ok: false,
      proxied: true,
      error: `Console MCP proxy error: ${error.message ?? String(error)}`,
    };
  }
}

/**
 * Get list of all allowlisted proxy tool names.
 */
export function getProxyAllowlist(): string[] {
  // Import dynamically to avoid circular deps
  const { CONSOLE_MCP_PROXY_TOOLS } = require("./tool-registry");
  return CONSOLE_MCP_PROXY_TOOLS
    .filter((t: any) => t.status === "active")
    .map((t: any) => t.name);
}
