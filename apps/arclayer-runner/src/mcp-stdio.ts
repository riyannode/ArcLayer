/**
 * MCP STDIO transport — JSON-RPC 2.0 over stdin/stdout.
 *
 * Protocol: MCP 2024-11-05
 * - stdin: NDJSON (one JSON-RPC request per line)
 * - stdout: JSON-RPC responses only (no logs, no noise)
 * - stderr: all logs
 *
 * Security: No Bearer auth. Process isolation is the boundary.
 * This mode is designed for local MCP sidecar use (Hermes, OpenClaw).
 *
 * Reuses RUNNER_MCP_TOOLS and handleMcpTool from the HTTP MCP server.
 */

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { createRequire } from "node:module";
import { RUNNER_MCP_TOOLS } from "./mcp-schemas";
import { handleMcpTool, type McpToolContext } from "./mcp-tools";
import { getToolNamesForRole } from "./tool-registry";

// Read version from package.json (works in both dev and bundled)
let PKG_VERSION = "0.1.3";
try {
  const require = createRequire(import.meta.url);
  PKG_VERSION = require("../package.json").version;
} catch {
  // fallback — keep default
}

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const SERVER_INFO = {
  name: "arclayer-runner",
  version: PKG_VERSION
};

const PROTOCOL_VERSION = "2024-11-05";

function stderrLog(msg: string): void {
  process.stderr.write(`[arclayer-runner-mcp] ${msg}\n`);
}

function rpcOk(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

/**
 * Handle a single JSON-RPC request.
 * Exported for direct unit testing.
 * Returns undefined for notifications (no id → no response).
 */
export async function handleStdioRequest(
  rpc: JsonRpcRequest,
  ctx: McpToolContext
): Promise<JsonRpcResponse | undefined> {
  const { method, params } = rpc;

  // Notifications (no id) — no response needed
  if (rpc.id === undefined) {
    if (method === "notifications/initialized") {
      stderrLog("Client initialized");
    } else {
      stderrLog(`Notification: ${method}`);
    }
    return undefined;
  }

  const id = rpc.id;

  switch (method) {
    // ── MCP Initialize ─────────────────────────────────────────────────
    case "initialize": {
      stderrLog(`Initialize from ${(params as any)?.clientInfo?.name ?? "unknown"}`);
      return rpcOk(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {}
        },
        serverInfo: SERVER_INFO
      });
    }

    // ── Tools List ─────────────────────────────────────────────────────
    case "tools/list": {
      stderrLog(`tools/list → ${RUNNER_MCP_TOOLS.length} tools`);
      return rpcOk(id, { tools: RUNNER_MCP_TOOLS });
    }

    // ── Tools Call ─────────────────────────────────────────────────────
    case "tools/call": {
      const toolName = (params as any)?.name;
      const toolArgs = (params as any)?.arguments ?? {};

      if (!toolName) {
        return rpcError(id, -32602, "Missing tool name");
      }

      // ── Role authorization gate ──────────────────────────────────────
      // tools/list is cosmetic filtering. This is the REAL enforcement.
      const allowedRoles = ctx.config.allowedRoles ?? [ctx.config.defaultRole];
      const allowedTools = new Set<string>();
      for (const role of allowedRoles) {
        for (const name of getToolNamesForRole(role)) {
          allowedTools.add(name);
        }
      }
      if (!allowedTools.has(toolName)) {
        stderrLog(`tools/call BLOCKED: ${toolName} not allowed for role ${ctx.config.defaultRole}`);
        return rpcOk(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                error: "ROLE_TOOL_NOT_ALLOWED",
                message: `Tool '${toolName}' is not allowed for role '${ctx.config.defaultRole}'`,
                allowedRoles
              })
            }
          ],
          isError: true
        });
      }

      stderrLog(`tools/call: ${toolName}`);

      try {
        const result = await handleMcpTool(toolName, toolArgs, ctx);
        // MCP tools/call wraps result in content array
        return rpcOk(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        });
      } catch (error: any) {
        const message = error?.message ?? "Tool execution failed";
        stderrLog(`tools/call error: ${message}`);
        return rpcOk(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, error: message })
            }
          ],
          isError: true
        });
      }
    }

    // ── Ping ───────────────────────────────────────────────────────────
    case "ping": {
      return rpcOk(id, {});
    }

    // ── Unknown method ─────────────────────────────────────────────────
    default: {
      stderrLog(`Unknown method: ${method}`);
      return rpcError(id, -32601, `Method not found: ${method}`);
    }
  }
}

/**
 * Run the MCP STDIO server.
 * Reads NDJSON from input, writes JSON-RPC to output.
 * Resolves when input closes (EOF).
 *
 * Accepts streams for testability. Defaults to process.stdin/stdout.
 */
export async function runMcpStdio(
  ctx: McpToolContext,
  input: Readable = process.stdin,
  output: Writable = process.stdout
): Promise<void> {
  stderrLog("ArcLayer Runner MCP STDIO server starting");
  stderrLog(`Agent: ${ctx.config.agentId} (${ctx.config.defaultRole})`);
  stderrLog(`Runtime: ${ctx.config.runtimeKind} → ${ctx.config.runtimeEndpoint}`);
  stderrLog(`Tools: ${RUNNER_MCP_TOOLS.map((t) => t.name).join(", ")}`);
  stderrLog("Waiting for JSON-RPC on stdin...");

  return new Promise<void>((resolve) => {
    const rl = createInterface({
      input,
      terminal: false
    });

    let lineCount = 0;
    let pending = 0;

    const sendResponse = (response: JsonRpcResponse): void => {
      output.write(JSON.stringify(response) + "\n");
    };

    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      lineCount++;
      let rpc: JsonRpcRequest;

      try {
        rpc = JSON.parse(trimmed);
      } catch {
        sendResponse(rpcError(0, -32700, "Parse error"));
        return;
      }

      if (!rpc || rpc.jsonrpc !== "2.0" || !rpc.method) {
        const id = (rpc as any)?.id ?? 0;
        sendResponse(rpcError(id, -32600, "Invalid Request"));
        return;
      }

      pending++;
      try {
        const response = await handleStdioRequest(rpc, ctx);
        if (response) {
          sendResponse(response);
        }
      } catch (error: any) {
        const message = error?.message ?? "Internal error";
        stderrLog(`Unhandled error: ${message}`);
        if (rpc.id !== undefined) {
          sendResponse(rpcError(rpc.id, -32603, message));
        }
      } finally {
        pending--;
        if (pending === 0 && rl.closed) {
          resolve();
        }
      }
    });

    rl.on("close", () => {
      stderrLog(`stdin closed after ${lineCount} lines. Exiting.`);
      if (pending === 0) {
        resolve();
      }
    });

    // Keep process alive when used as main entry
    if (input === process.stdin) {
      process.stdin.resume();
    }
  });
}
