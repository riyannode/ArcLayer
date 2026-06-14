/**
 * ArcLayer Runner MCP — Local MCP server via STDIO transport.
 *
 * Thin wrapper using official @modelcontextprotocol/sdk StdioServerTransport.
 * All tool logic, broker, policy, audit handled by runner-mcp-executor.ts.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpToolContext } from './mcp-tools';
import { createRunnerMcpServer } from './runner-mcp-server';

function stderrLog(msg: string): void {
  process.stderr.write(`[arclayer-runner-mcp] ${msg}\n`);
}

export type McpStdioCleanup = {
  /** Close the remote MCP connector (Console bridge) */
  closeMcp?: () => Promise<void>;
  /** Close services (stores, SQLite, etc.) */
  closeServices?: () => Promise<void>;
};

/**
 * Run the ArcLayer Runner MCP server over STDIO.
 * Uses official SDK StdioServerTransport.
 *
 * @param ctx - MCP tool context (services, mcp, config, broker)
 * @param cleanup - Optional cleanup callbacks for graceful shutdown.
 *                  Called in order: server → mcp → services.
 */
export async function runMcpStdio(
  ctx: McpToolContext,
  cleanup?: McpStdioCleanup,
): Promise<void> {
  stderrLog('ArcLayer Runner MCP starting (STDIO)');
  stderrLog(`Agent: ${ctx.config.agentId} (${ctx.config.defaultRole})`);
  stderrLog(`Runtime: ${ctx.config.runtimeKind} → ${ctx.config.runtimeEndpoint}`);

  const server = createRunnerMcpServer(ctx);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  stderrLog('ArcLayer Runner MCP connected. Waiting for requests...');

  // Graceful shutdown — idempotent, runs once
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stderrLog('Shutting down...');

    try {
      await server.close();
    } catch {
      // ignore close errors
    }

    try {
      await cleanup?.closeMcp?.();
    } catch {
      // ignore close errors
    }

    try {
      await cleanup?.closeServices?.();
    } catch {
      // ignore close errors
    }

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
