/**
 * ArcLayer Global MCP — Scope verification.
 *
 * Explicit scope check. No wildcard support.
 */

export function hasMcpScope(
  scopes: readonly string[],
  requiredScope: string,
): boolean {
  return scopes.includes(requiredScope);
}
