/**
 * ArcLayer Runner MCP — Local MCP server via STDIO transport.
 *
 * Thin wrapper using official @modelcontextprotocol/sdk StdioServerTransport.
 * All tool logic, broker, policy, audit handled by runner-mcp-executor.ts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpToolContext } from './mcp-tools';
import { createRunnerMcpServer } from './runner-mcp-server';

function stderrLog(msg: string): void {
  process.stderr.write(`[arclayer-runner-mcp] ${msg}\n`);
}

/**
 * Run the ArcLayer Runner MCP server over STDIO.
 * Uses official SDK StdioServerTransport.
 */
export async function runMcpStdio(ctx: McpToolContext): Promise<void> {
  stderrLog('ArcLayer Runner MCP starting (STDIO)');
  stderrLog(`Agent: ${ctx.config.agentId} (${ctx.config.defaultRole})`);
  stderrLog(`Runtime: ${ctx.config.runtimeKind} → ${ctx.config.runtimeEndpoint}`);

  const server = createRunnerMcpServer(ctx);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  stderrLog('ArcLayer Runner MCP connected. Waiting for requests...');

  // Handle graceful shutdown
  const shutdown = async () => {
    stderrLog('Shutting down...');
    try {
      await server.close();
    } catch {
      // ignore close errors
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
