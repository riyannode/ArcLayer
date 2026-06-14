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
 * Convert a tool inputSchema to a Zod raw shape.
 * Handles both JSON Schema ({ type: 'object', properties }) and
 * flat field map ({ fieldName: { type: 'string', required: true } }) formats.
 */
function jsonSchemaToZodShape(
  schema?: Record<string, unknown>,
): Record<string, z.ZodTypeAny> | undefined {
  if (!schema) return undefined;

  // JSON Schema format: { type: 'object', properties: { ... } }
  if (schema.type === 'object' && schema.properties) {
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
          field = z.record(z.string(), z.unknown());
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

  // Flat field map format: { fieldName: { type: 'string', required: true } }
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, spec] of Object.entries(schema)) {
    if (typeof spec !== 'object' || spec === null) continue;
    const prop = spec as Record<string, unknown>;
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
        field = z.record(z.string(), z.unknown());
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

    if (!prop.required) {
      field = field.optional();
    }

    shape[key] = field;
  }

  return Object.keys(shape).length > 0 ? shape : undefined;
}
