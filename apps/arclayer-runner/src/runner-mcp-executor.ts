/**
 * ArcLayer Runner MCP — Tool Executor.
 *
 * Centralizes: role authorization, broker.preExecute, schema validation,
 * budget enforcement, max call enforcement, privileged tool restrictions,
 * timeout, AbortController propagation, handler execution, broker.postExecute,
 * output-size enforcement, audit logging, failure logging, error sanitization.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpToolContext } from './mcp-tools';
import { handleMcpTool } from './mcp-tools';
import { getToolNamesForRole } from './tool-registry';
import {
  McpToolBroker,
  BrokerError,
  BrokerErrorCode,
} from './mcp-broker';

function stderrLog(msg: string): void {
  process.stderr.write(`[arclayer-runner-mcp] ${msg}\n`);
}

/**
 * Sanitize error messages before returning to MCP host.
 * Strips internal paths, URLs, tokens, and sensitive details.
 */
function sanitizeErrorMessage(message: string): string {
  if (!message) return 'Tool execution failed';

  // Strip absolute paths (Unix and Windows)
  let sanitized = message.replace(/\/[\w./-]+/g, '[path]');
  sanitized = sanitized.replace(/[A-Z]:\\[\w\\.-]+/g, '[path]');

  // Strip URLs with auth info or internal hosts
  sanitized = sanitized.replace(/https?:\/\/[^\s]+/g, '[url]');

  // Strip potential tokens/secrets (long hex strings, base64)
  sanitized = sanitized.replace(/\b[0-9a-f]{32,}\b/gi, '[redacted]');
  sanitized = sanitized.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '[redacted]');

  // Strip file:// paths
  sanitized = sanitized.replace(/file:\/\/[^\s]+/g, '[path]');

  // Cap length
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 497) + '...';
  }

  return sanitized;
}

/**
 * Wrap a promise with a timeout. Rejects with BrokerError on timeout.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  toolName: string,
  controller?: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller?.abort();
      reject(new BrokerError(
        BrokerErrorCode.TOOL_TIMEOUT,
        `Tool '${toolName}' timed out after ${ms}ms`,
        { tool: toolName, timeoutMs: ms },
      ));
    }, ms);

    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Execute a Runner MCP tool with full broker/policy/audit pipeline.
 */
export async function executeRunnerMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: McpToolContext,
): Promise<CallToolResult> {
  // ── Role authorization gate ──────────────────────────────────────────
  const allowedRoles = ctx.config.allowedRoles ?? [ctx.config.defaultRole];
  const allowedTools = new Set<string>();
  for (const role of allowedRoles) {
    for (const name of getToolNamesForRole(role)) {
      allowedTools.add(name);
    }
  }

  if (!allowedTools.has(toolName)) {
    stderrLog(`tools/call BLOCKED: ${toolName} not allowed for role ${ctx.config.defaultRole}`);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: false,
            error: 'ROLE_TOOL_NOT_ALLOWED',
            message: `Tool '${toolName}' is not allowed for role '${ctx.config.defaultRole}'`,
            allowedRoles,
          }),
        },
      ],
      isError: true,
    };
  }

  // ── Broker: pre-execute checks ───────────────────────────────────────
  const broker = ctx.broker;
  if (broker) {
    try {
      broker.preExecute(toolName, args);
    } catch (error) {
      if (error instanceof BrokerError) {
        broker.recordRejection(toolName, args, error);
        stderrLog(`tools/call BLOCKED by broker: ${error.code} — ${error.message}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: error.code,
                message: error.message,
                details: error.details,
              }),
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  }

  // ── Broker: execute with timeout ─────────────────────────────────────
  const timeoutMs = broker?.getTimeoutMs(toolName) ?? 30_000;
  const startTime = Date.now();

  const abortController = new AbortController();

  try {
    const ctxWithSignal = { ...ctx, signal: abortController.signal, proxyTimeoutMs: timeoutMs };
    const result = await withTimeout(
      handleMcpTool(toolName, args, ctxWithSignal),
      timeoutMs,
      toolName,
      abortController,
    );

    // ── Broker: post-execute checks (output size + audit) ──────────────
    if (broker) {
      broker.postExecute(toolName, args, result, Date.now() - startTime);
    }

    const serialized = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

    return {
      content: [
        {
          type: 'text',
          text: serialized,
        },
      ],
      structuredContent:
        typeof result === 'object' && result !== null && !Array.isArray(result)
          ? result as Record<string, unknown>
          : { value: result },
    };
  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    const isTimeout = error instanceof BrokerError
      && error.code === BrokerErrorCode.TOOL_TIMEOUT;

    if (broker) {
      broker.recordFailure(toolName, args, error, durationMs, isTimeout);
    }

    const message = error?.message ?? 'Tool execution failed';
    const errorCode = error instanceof BrokerError ? error.code : undefined;
    const sanitizedMessage = sanitizeErrorMessage(message);
    stderrLog(`tools/call error${errorCode ? ` (${errorCode})` : ''}: ${message}`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: false,
            error: errorCode ?? 'TOOL_ERROR',
            message: sanitizedMessage,
            details: error instanceof BrokerError ? error.details : undefined,
          }),
        },
      ],
      isError: true,
    };
  }
}
