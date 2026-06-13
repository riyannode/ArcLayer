/**
 * Runner-local MCP server — JSON-RPC 2.0 handler.
 *
 * Serves tools/list and tools/call for MCP-capable clients.
 * Auth is handled by the HTTP router (HMAC or Bearer) — this handler
 * receives pre-authenticated context and MUST NOT re-read the request
 * stream or re-verify auth.
 *
 * Tools call existing Runner service methods — no direct Circle CLI.
 */

import type { ServerResponse } from "node:http";
import { RUNNER_MCP_TOOLS } from "./mcp-schemas";
import { handleMcpTool, type McpToolContext } from "./mcp-tools";
import { getToolNamesForRole } from "./tool-registry";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function jsonRpcOk(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function sendJson(res: ServerResponse, data: JsonRpcResponse) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}

/**
 * Handle POST /mcp — JSON-RPC 2.0 endpoint.
 *
 * Auth is done by the HTTP router before this handler is called.
 * This handler receives the already-parsed JSON-RPC body and
 * does NOT read from the request stream.
 *
 * For STDIO mode, use runMcpStdio() instead.
 *
 * @param res - HTTP response (for writing JSON-RPC responses)
 * @param body - Pre-parsed JSON body from router (JSON-RPC request)
 * @param ctx - MCP tool context (services, mcp, config, skill)
 */
export async function handleMcpRequest(
  res: ServerResponse,
  body: unknown,
  ctx: McpToolContext
): Promise<void> {
  let rpcId: string | number = 0;

  try {
    // Validate JSON-RPC envelope (auth already done by router)
    const rpc = body as JsonRpcRequest;
    if (!rpc || rpc.jsonrpc !== "2.0" || !rpc.method || !rpc.id) {
      sendJson(res, jsonRpcError(rpc?.id ?? 0, -32600, "Invalid Request"));
      return;
    }

    rpcId = rpc.id;

    switch (rpc.method) {
      case "tools/list":
        sendJson(res, jsonRpcOk(rpc.id, { tools: RUNNER_MCP_TOOLS }));
        break;

      case "tools/call": {
        const toolName = (rpc.params as Record<string, unknown>)?.name as string;
        const toolArgs = ((rpc.params as Record<string, unknown>)?.arguments ?? {}) as Record<string, unknown>;
        if (!toolName) {
          sendJson(res, jsonRpcError(rpc.id, -32602, "Missing tool name"));
          return;
        }

        // ── Role authorization gate ──────────────────────────────────
        // This is tool-level authorization, NOT transport auth.
        // Transport auth (HMAC/Bearer) is handled by the HTTP router.
        const allowedRoles = ctx.config.allowedRoles ?? [ctx.config.defaultRole];
        const allowedTools = new Set<string>();
        for (const role of allowedRoles) {
          for (const name of getToolNamesForRole(role)) {
            allowedTools.add(name);
          }
        }
        if (!allowedTools.has(toolName)) {
          sendJson(res, jsonRpcOk(rpc.id, {
            content: [{
              type: "text",
              text: JSON.stringify({
                ok: false,
                error: "ROLE_TOOL_NOT_ALLOWED",
                message: `Tool '${toolName}' is not allowed for role '${ctx.config.defaultRole}'`,
                allowedRoles
              })
            }],
            isError: true
          }));
          return;
        }

        const result = await handleMcpTool(toolName, toolArgs, ctx);
        sendJson(res, jsonRpcOk(rpc.id, result));
        break;
      }

      default:
        sendJson(res, jsonRpcError(rpc.id, -32601, `Method not found: ${rpc.method}`));
        break;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal error";
    sendJson(res, jsonRpcError(rpcId, -32603, message));
  }
}
