/**
 * ArcLayer Runner MCP — Official SDK Server Factory.
 *
 * Creates an McpServer using @modelcontextprotocol/sdk v1.29.0.
 * Tools registered from runner-core Zod schemas.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpToolContext } from './mcp-tools';
import { executeRunnerMcpTool } from './runner-mcp-executor';
import { RUNNER_MCP_TOOLS } from './mcp-schemas';

/**
 * Create an official MCP server with all Runner tools registered.
 */
export function createRunnerMcpServer(ctx: McpToolContext): McpServer {
  const server = new McpServer({
    name: 'arclayer-runner',
    version: '0.1.4',
  });

  // Register tools from RUNNER_MCP_TOOLS definitions
  for (const toolDef of RUNNER_MCP_TOOLS) {
    // Convert JSON Schema to Zod shape for the SDK
    const inputSchema = jsonSchemaToZodShape(toolDef.inputSchema);

    server.registerTool(
      toolDef.name,
      {
        description: toolDef.description,
        inputSchema: inputSchema ? z.object(inputSchema) : undefined,
      },
      async (args: Record<string, unknown>) => {
        return executeRunnerMcpTool(toolDef.name, args, ctx);
      },
    );
  }

  return server;
}

/**
 * Convert a JSON Schema object to a Zod raw shape.
 * Handles the subset of types used by Runner tools.
 */
function jsonSchemaToZodShape(
  schema?: Record<string, unknown>,
): Record<string, z.ZodTypeAny> | undefined {
  if (!schema || schema.type !== 'object' || !schema.properties) return undefined;

  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required as string[]) ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodTypeAny;

    switch (prop.type) {
      case 'string':
        field = z.string();
        break;
      case 'number':
      case 'integer':
        field = z.number();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      case 'object':
        field = z.record(z.unknown());
        break;
      case 'array':
        field = z.array(z.unknown());
        break;
      default:
        field = z.unknown();
    }

    if (prop.description) {
      field = field.describe(prop.description as string);
    }

    if (!required.has(key)) {
      field = field.optional();
    }

    shape[key] = field;
  }

  return shape;
}
