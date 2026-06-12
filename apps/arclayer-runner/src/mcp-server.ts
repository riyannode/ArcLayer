/**
 * Runner-local MCP server — JSON-RPC 2.0 handler.
 *
 * Serves tools/list and tools/call for MCP-capable clients.
 * Same auth policy as HTTP routes (Bearer token, default-deny).
 * Tools call existing Runner service methods — no direct Circle CLI.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { assertAuthenticated, RunnerError } from "@arclayer/runner-core";
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

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 1024 * 1024) throw new Error("Body too large");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

function sendJson(res: ServerResponse, data: JsonRpcResponse) {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}

/**
 * Handle POST /mcp — JSON-RPC 2.0 endpoint.
 * Requires Bearer auth. Calls Runner service methods only.
 */
export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  runnerSecret: string,
  ctx: McpToolContext
): Promise<void> {
  // All logic inside try-catch so auth failures are caught too
  let rpcId: string | number = 0;

  try {
    // Auth (default-deny — /mcp is NOT in public routes)
    assertAuthenticated(req, runnerSecret);

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, jsonRpcError(0, -32700, "Parse error"));
      return;
    }

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
        const toolName = (rpc.params as any)?.name;
        const toolArgs = (rpc.params as any)?.arguments ?? {};
        if (!toolName) {
          sendJson(res, jsonRpcError(rpc.id, -32602, "Missing tool name"));
          return;
        }

        // ── Role authorization gate (HTTP) ────────────────────────────
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
  } catch (error: any) {
    const message = error?.message ?? "Internal error";
    const code = error instanceof RunnerError && error.status === 401 ? -32001 : -32603;
    sendJson(res, jsonRpcError(rpcId, code, message));
  }
}
