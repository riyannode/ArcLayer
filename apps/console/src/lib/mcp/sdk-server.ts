/**
 * ArcLayer Global MCP — Official SDK Server Factory.
 *
 * Creates an McpServer using @modelcontextprotocol/sdk v1.29.0.
 * All tools registered from tool-catalog.ts with proper Zod schemas.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpToolContext } from './registry';
import { registerAllTools, validateToolCatalog, resolveAlias } from './tool-catalog';
import { listTools } from './registry';
import { buildSdkInputSchema } from './sdk-schema';
import { executeCatalogTool } from './tool-executor';

let validated = false;

/**
 * Create an official MCP server with all ArcLayer tools registered.
 * Creates a fresh server per request (stateless Next.js route).
 */
export function createArcLayerMcpServer(
  context: McpToolContext,
): McpServer {
  // Validate catalog once
  if (!validated) {
    validateToolCatalog();
    validated = true;
  }

  registerAllTools();

  const server = new McpServer({
    name: 'arclayer-global-mcp',
    version: '0.1.0',
  });

  // Register all tools from catalog
  for (const tool of listTools()) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: buildSdkInputSchema(tool.inputSchema),
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => {
        return executeCatalogTool(tool, args, context, context.auth?.scopes);
      },
    );
  }

  return server;
}
