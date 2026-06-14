/**
 * ArcLayer Global MCP — Scope compatibility shim.
 *
 * Re-exports from scope-check.ts. No wildcard, no PUBLIC_MCP_TOOLS.
 * This file exists only for backward compatibility during migration.
 * Will be deleted in Commit 8 after all imports are migrated.
 */

export { hasMcpScope } from './scope-check';

/** @deprecated Use tool.requiredScope from registry instead. */
export const TOOL_SCOPES: Record<string, string> = {};

/** @deprecated No public tools after hard cut. All tools require explicit scope. */
export const PUBLIC_MCP_TOOLS = new Set<string>();
