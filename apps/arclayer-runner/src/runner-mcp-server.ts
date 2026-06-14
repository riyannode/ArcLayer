/**
 * ArcLayer Runner MCP — Official SDK Server Factory.
 *
 * Creates an McpServer using @modelcontextprotocol/sdk v1.29.0.
 * Registers both local Runner tools and Console MCP proxy tools,
 * filtered by the configured role(s).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpToolContext } from './mcp-tools';
import { executeRunnerMcpTool } from './runner-mcp-executor';
import { RUNNER_MCP_TOOLS, CONSOLE_PROXY_MCP_TOOLS, type McpToolDef } from './mcp-schemas';
import { proxyToConsoleMcp } from './console-tool-proxy';
import { getToolNamesForRole } from './tool-registry';

/**
 * Create an official MCP server with tools registered for the configured role(s).
 *
 * Registers:
 * - Local Runner tools (from RUNNER_MCP_TOOLS)
 * - Console MCP proxy tools (from CONSOLE_PROXY_MCP_TOOLS)
 *
 * Both sets are filtered by the union of tools allowed for `config.allowedRoles`.
 * Execution-time role checks in the executor remain as defense in depth.
 */
export function createRunnerMcpServer(ctx: McpToolContext): McpServer {
  const server = new McpServer({
    name: 'arclayer-runner',
    version: '0.1.4',
  });

  // Build the set of allowed tool names for the configured role(s)
  const allowedRoles = ctx.config.allowedRoles ?? [ctx.config.defaultRole];
  const allowedToolNames = new Set<string>();
  for (const role of allowedRoles) {
    for (const name of getToolNamesForRole(role)) {
      allowedToolNames.add(name);
    }
  }

  // Register local Runner tools (filtered by role)
  for (const toolDef of RUNNER_MCP_TOOLS) {
    if (!allowedToolNames.has(toolDef.name)) continue;
    registerToolDef(server, toolDef, ctx, 'local');
  }

  // Register Console MCP proxy tools (filtered by role)
  for (const toolDef of CONSOLE_PROXY_MCP_TOOLS) {
    if (!allowedToolNames.has(toolDef.name)) continue;
    registerToolDef(server, toolDef, ctx, 'proxy');
  }

  return server;
}

/**
 * Register a single tool definition on the McpServer.
 */
function registerToolDef(
  server: McpServer,
  toolDef: McpToolDef,
  ctx: McpToolContext,
  source: 'local' | 'proxy',
): void {
  const inputSchema = jsonSchemaToZodShape(toolDef.inputSchema);

  server.registerTool(
    toolDef.name,
    {
      description: toolDef.description,
      inputSchema: inputSchema ? z.object(inputSchema) : undefined,
    },
    async (args: Record<string, unknown>) => {
      if (source === 'proxy') {
        // Proxy tools are forwarded to Console MCP via the connector.
        // The executor's role gate still applies (defense in depth).
        return executeRunnerMcpTool(toolDef.name, args, ctx);
      }
      return executeRunnerMcpTool(toolDef.name, args, ctx);
    },
  );
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
