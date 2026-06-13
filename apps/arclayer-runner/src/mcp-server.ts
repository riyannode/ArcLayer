/**
 * Runner-local MCP server — JSON-RPC 2.0 handler.
 *
 * Serves tools/list and tools/call for MCP-capable clients.
 * Auth is handled by the HTTP router (HMAC or Bearer) — this handler
 * receives pre-authenticated context and MUST NOT re-read the request
 * stream or re-verify auth.
 *
 * Tools call existing Runner service methods — no direct Circle CLI.
 *
 * PR #3: MCP Tool Broker integration — schema validation, timeouts,
 * budget enforcement, output size caps, audit logging.
 */

import type { ServerResponse } from "node:http";
import { RUNNER_MCP_TOOLS } from "./mcp-schemas";
import { handleMcpTool, type McpToolContext } from "./mcp-tools";
import { getToolNamesForRole } from "./tool-registry";
import {
  McpToolBroker,
  BrokerError,
  BrokerErrorCode,
  type ToolBudgetConfig,
} from "./mcp-broker";

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
 * Map BrokerError to JSON-RPC error code.
 * Uses -32000 to -32099 range (server-defined errors per JSON-RPC spec).
 */
function brokerErrorToRpcCode(code: BrokerErrorCode): number {
  const map: Record<BrokerErrorCode, number> = {
    [BrokerErrorCode.TOOL_NOT_FOUND]: -32001,
    [BrokerErrorCode.SCHEMA_VALIDATION_FAILED]: -32002,
    [BrokerErrorCode.TOOL_NOT_ALLOWED]: -32003,
    [BrokerErrorCode.TOOL_TIMEOUT]: -32004,
    [BrokerErrorCode.BUDGET_EXCEEDED]: -32005,
    [BrokerErrorCode.MAX_CALLS_EXCEEDED]: -32006,
    [BrokerErrorCode.OUTPUT_TOO_LARGE]: -32007,
    [BrokerErrorCode.PRIVILEGED_TOOL_DENIED]: -32008,
    [BrokerErrorCode.INTERNAL_ERROR]: -32603,
  };
  return map[code] ?? -32603;
}

/**
 * Wrap a promise with a timeout. Rejects with BrokerError on timeout.
 *
 * When the timeout fires, the provided AbortController is aborted so that
 * underlying operations (Circle CLI subprocess, HTTP fetch) can be cancelled.
 * This distinguishes "client timed out, operation may have completed" from
 * "operation actually failed" for non-idempotent on-chain writes.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  toolName: string,
  controller?: AbortController
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Abort the underlying operation if an AbortController was provided
      controller?.abort();
      reject(new BrokerError(
        BrokerErrorCode.TOOL_TIMEOUT,
        `Tool '${toolName}' timed out after ${ms}ms`,
        { tool: toolName, timeoutMs: ms }
      ));
    }, ms);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

/**
 * Send a broker error as a JSON-RPC result (MCP tools/call error format).
 */
function sendBrokerError(res: ServerResponse, rpcId: string | number, error: BrokerError): void {
  sendJson(res, jsonRpcOk(rpcId, {
    content: [{
      type: "text",
      text: JSON.stringify({
        ok: false,
        error: error.code,
        message: error.message,
        details: error.details
      })
    }],
    isError: true
  }));
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
 * @param broker - MCP Tool Broker instance (per-session budget/audit), or null if disabled
 */
export async function handleMcpRequest(
  res: ServerResponse,
  body: unknown,
  ctx: McpToolContext,
  broker?: McpToolBroker | null
): Promise<void> {
  let rpcId: string | number = 0;

  // broker=undefined → no broker (backward compat / disabled)
  // broker=McpToolBroker → active broker
  // Do NOT create a default broker when explicitly disabled.
  const toolBroker = broker ?? undefined;

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

        // ── Broker: pre-execute checks ───────────────────────────────
        if (toolBroker) {
          try {
            toolBroker.preExecute(toolName, toolArgs);
          } catch (error) {
            if (error instanceof BrokerError) {
              // Audit the rejection (highest-value forensics event)
              toolBroker.recordRejection(toolName, toolArgs, error);
              sendBrokerError(res, rpc.id, error);
              return;
            }
            throw error;
          }
        }

        // ── Broker: execute with timeout ─────────────────────────────
        const timeoutMs = toolBroker?.getTimeoutMs(toolName) ?? 30_000;
        const startTime = Date.now();

        // Create AbortController for cancellation propagation.
        // When the broker timeout fires, controller.abort() is called,
        // which propagates the signal to Circle CLI subprocess / HTTP fetch.
        const abortController = new AbortController();

        try {
          // Pass broker + signal into ctx so tools can access them.
          const ctxWithExtras = {
            ...ctx,
            broker: toolBroker ?? ctx.broker,
            signal: abortController.signal,
          };
          const result = await withTimeout(
            handleMcpTool(toolName, toolArgs, ctxWithExtras),
            timeoutMs,
            toolName,
            abortController
          );

          // ── Broker: post-execute checks (output size + audit) ──────
          if (toolBroker) {
            toolBroker.postExecute(toolName, toolArgs, result, Date.now() - startTime);
          }

          sendJson(res, jsonRpcOk(rpc.id, result));
        } catch (error) {
          const durationMs = Date.now() - startTime;

          // Detect timeout errors — for non-idempotent writes, the underlying
          // operation may still complete even though the client timed out.
          const isTimeout = error instanceof BrokerError
            && error.code === BrokerErrorCode.TOOL_TIMEOUT;

          // Record failure in audit log (also releases call slot)
          if (toolBroker) {
            toolBroker.recordFailure(toolName, toolArgs, error, durationMs, isTimeout);
          }

          if (error instanceof BrokerError) {
            sendBrokerError(res, rpc.id, error);
            return;
          }
          throw error;
        }
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
