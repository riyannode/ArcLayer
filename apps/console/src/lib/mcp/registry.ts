/**
 * ArcLayer Global MCP — Tool Registry.
 *
 * Static deny-by-default registry. Every tool must be explicitly registered.
 * Supports legacy aliases so old tool names resolve to canonical tools.
 */

// ─── TYPES ───────────────────────────────────────────────────────────────────

/** Minimal request context passed through the MCP server pipeline. */
export interface RequestContext {
  origin: string;
  method: string;
  userAgent?: string | null;
  ip?: string | null;
  /** Authorization header value (Bearer token). Used by authenticated tools. */
  authorization?: string | null;
}

/** Context available to every tool handler at invocation time. */
import type { McpAuthContext } from './auth';

export interface McpToolContext {
  request: RequestContext;
  auth?: McpAuthContext | null;
}

/** Tool handler signature. */
export type McpToolHandler = (
  args: Record<string, unknown>,
  context: McpToolContext,
) => Promise<unknown>;

/** JSON Schema-style input description for a single parameter. */
export interface McpToolParam {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

/** Full tool definition stored in the registry. */
export interface McpToolDefinition {
  /** Canonical MCP tool name (e.g. "protocol.status"). */
  name: string;
  /** Functional domain grouping. */
  domain: string;
  /** Human-readable description. */
  description: string;
  /** Whether this tool requires authentication (future use). */
  authRequired: boolean;
  /** Roles allowed to invoke this tool (future use). */
  roles: string[];
  /** Input parameter schema for tools/list. */
  inputSchema: McpToolParam[];
  /** Legacy alias names that resolve to this tool. */
  legacyAliases: string[];
  /** Execution handler. */
  handler: McpToolHandler;
  /** Tool kind: read-only or returns unsigned tx instructions. */
  kind: 'read' | 'tx_instruction';
}

// ─── REGISTRY STATE ──────────────────────────────────────────────────────────

const tools = new Map<string, McpToolDefinition>();
const aliasMap = new Map<string, string>(); // alias → canonical name

// ─── REGISTRATION ────────────────────────────────────────────────────────────

/**
 * Register a tool in the global registry.
 * Also registers all legacy aliases.
 * Throws if a canonical name is registered twice.
 */
export function registerTool(def: McpToolDefinition): void {
  if (tools.has(def.name)) {
    throw new Error(`MCP tool already registered: ${def.name}`);
  }
  tools.set(def.name, def);
  for (const alias of def.legacyAliases) {
    if (aliasMap.has(alias) && aliasMap.get(alias) !== def.name) {
      throw new Error(`MCP alias conflict: "${alias}" already maps to "${aliasMap.get(alias)}"`);
    }
    aliasMap.set(alias, def.name);
  }
}

// ─── LOOKUP ──────────────────────────────────────────────────────────────────

/**
 * Resolve a tool name or legacy alias to its definition.
 * Returns undefined if not found.
 */
export function getTool(name: string): McpToolDefinition | undefined {
  const canonical = aliasMap.get(name) ?? name;
  return tools.get(canonical);
}

/** Check whether a tool name or alias exists. */
export function hasTool(name: string): boolean {
  return tools.has(name) || aliasMap.has(name);
}

/** List all registered tools (canonical names only). */
export function listTools(): McpToolDefinition[] {
  return Array.from(tools.values());
}

/** Get all registered canonical tool names. */
export function listToolNames(): string[] {
  return Array.from(tools.keys());
}

/** Get all registered alias names. */
export function listAliases(): string[] {
  return Array.from(aliasMap.keys());
}

/**
 * Convert a tool definition into the MCP tools/list response shape.
 */
export function toMcpToolSchema(def: McpToolDefinition) {
  return {
    name: def.name,
    description: def.description,
    inputSchema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        def.inputSchema.map((p) => [
          p.name,
          {
            type: p.type,
            ...(p.description ? { description: p.description } : {}),
          },
        ]),
      ),
      required: def.inputSchema.filter((p) => p.required).map((p) => p.name),
    },
  };
}
