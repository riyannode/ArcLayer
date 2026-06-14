/**
 * ArcLayer Global MCP — Tool Registry.
 *
 * Static deny-by-default registry. Every tool must be explicitly registered
 * with scope, operation type, and annotations. No legacy aliases.
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

/** Operation classification for MCP tool. */
export type McpOperation =
  | 'read'
  | 'mutation'
  | 'tx_prepare'
  | 'signing_request';

/** MCP tool annotations (explicit per tool, NOT auto-derived). */
export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

/** Full tool definition stored in the registry. */
export interface McpToolDefinition {
  /** Canonical MCP tool name (e.g. "protocol.status"). */
  name: string;
  /** Functional domain grouping. */
  domain: string;
  /** Human-readable description. */
  description: string;
  /** Explicit required OAuth/runtime scope (e.g. "arclayer:read"). */
  requiredScope: string;
  /** Operation type. */
  operation: McpOperation;
  /** MCP tool annotations. */
  annotations: McpToolAnnotations;
  /** Input parameter schema for tools/list. */
  inputSchema: McpToolParam[];
  /** Execution handler. */
  handler: McpToolHandler;
}

// ─── REGISTRY STATE ──────────────────────────────────────────────────────────

const tools = new Map<string, McpToolDefinition>();

// ─── REGISTRATION ────────────────────────────────────────────────────────────

/**
 * Register a tool in the global registry.
 * Throws if a canonical name is registered twice.
 */
export function registerTool(def: McpToolDefinition): void {
  if (tools.has(def.name)) {
    throw new Error(`MCP tool already registered: ${def.name}`);
  }
  tools.set(def.name, def);
}

// ─── LOOKUP ──────────────────────────────────────────────────────────────────

/**
 * Resolve a tool name to its definition.
 * Returns undefined if not found.
 */
export function getTool(name: string): McpToolDefinition | undefined {
  return tools.get(name);
}

/** List all registered tools (canonical names only). */
export function listTools(): McpToolDefinition[] {
  return Array.from(tools.values());
}

/** Get all registered canonical tool names. */
export function listToolNames(): string[] {
  return Array.from(tools.keys());
}

/** Clear all registered tools (for testing). */
export function clearRegistry(): void {
  tools.clear();
}
