export const MCP_OAUTH_RESOURCE = 'https://arclayers.xyz/api/mcp';
export const OAUTH_ISSUER = 'https://arclayers.xyz';
export const ALLOWED_MCP_SCOPES = ['arclayer:read','agents:read','jobs:read','jobs:prepare','tx:request','provider:runtime'] as const;
export type McpOAuthScope = (typeof ALLOWED_MCP_SCOPES)[number];
export function parseScopes(value: string | undefined): McpOAuthScope[] | null {
  const values = (value ?? '').split(/\s+/).filter(Boolean);
  const unique = [...new Set(values)];
  return unique.every((scope) => (ALLOWED_MCP_SCOPES as readonly string[]).includes(scope)) ? unique as McpOAuthScope[] : null;
}
