/**
 * ArcLayer Global MCP — Tool executor.
 *
 * Centralizes: scope verification, handler invocation, bigint-safe serialization,
 * redaction, McpError translation, structuredContent, text fallback, isError.
 */

import type { McpToolDefinition, McpToolContext } from './registry';
import { hasMcpScope } from './scope-check';
import { MCP_ERRORS, McpError, thrownToMcpError } from './errors';
import { redactString } from './redact';

/** BigInt-safe JSON replacer. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** Deep-serialize an object, converting BigInt values to strings. */
function serializeBigInt<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, bigintReplacer));
}

/**
 * Execute a catalog tool with scope verification, serialization, and error handling.
 */
export async function executeCatalogTool(
  tool: McpToolDefinition,
  args: Record<string, unknown>,
  context: McpToolContext,
  authScopes?: string[],
): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}> {
  // Scope verification
  if (authScopes && !hasMcpScope(authScopes, tool.requiredScope)) {
    throw new McpError(
      MCP_ERRORS.FORBIDDEN,
      `Missing required scope: ${tool.requiredScope}`,
      403,
    );
  }

  try {
    const result = await tool.handler(args, context);
    const serialized = serializeBigInt(result);

    // Wrap primitive/array results
    const structuredContent =
      typeof serialized === 'object' && serialized !== null && !Array.isArray(serialized)
        ? serialized
        : { value: serialized };

    const text = JSON.stringify(serialized, bigintReplacer, 2);

    return {
      content: [{ type: 'text', text }],
      structuredContent,
    };
  } catch (e) {
    const mcpErr = thrownToMcpError(e);
    const safeMessage = redactString(mcpErr.message);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: false,
            error: mcpErr.code,
            message: safeMessage,
          }),
        },
      ],
      isError: true,
    };
  }
}
