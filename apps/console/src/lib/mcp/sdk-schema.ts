/**
 * ArcLayer Global MCP — Zod schema adapter.
 *
 * Converts McpToolParam[] into Zod object schemas compatible with
 * @modelcontextprotocol/sdk v1.29.0.
 */

import { z } from 'zod';
import type { McpToolParam } from './registry';

/**
 * Build a Zod object schema from McpToolParam[].
 * Returns a ZodRawShape compatible with server.registerTool inputSchema.
 */
export function buildSdkInputSchema(params: McpToolParam[]): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const param of params) {
    let fieldSchema: z.ZodTypeAny;

    switch (param.type) {
      case 'string':
        fieldSchema = z.string();
        break;
      case 'number':
        fieldSchema = z.number();
        break;
      case 'integer':
        fieldSchema = z.number().int();
        break;
      case 'boolean':
        fieldSchema = z.boolean();
        break;
      case 'object':
        fieldSchema = z.record(z.string(), z.unknown());
        break;
      case 'array':
        fieldSchema = z.array(z.unknown());
        break;
      default:
        throw new Error(
          `Unsupported schema type "${param.type}" for param "${param.name}"`,
        );
    }

    if (param.description) {
      fieldSchema = fieldSchema.describe(param.description);
    }

    if (!param.required) {
      fieldSchema = fieldSchema.optional();
    }

    shape[param.name] = fieldSchema;
  }

  return z.object(shape);
}
