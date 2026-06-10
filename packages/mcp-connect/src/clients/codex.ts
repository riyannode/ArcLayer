import { access } from 'node:fs/promises';
import { arclayerMcpToml } from '../config/codex-config.js';
import { resolvePaths } from '../fs/paths.js';
import { readText } from '../fs/safe-write.js';
export async function codexStatus(home?: string) {
  const paths = resolvePaths(home); const config = await readText(paths.codexConfig);
  let skillExists = true; try { await access(paths.skillFile); } catch { skillExists = false; }
  return { paths, configExists: !!config, mcpConfigured: config.includes('[mcp_servers.arclayer]'), oauthReady: config.includes('oauth_resource') && config.includes('mcp_oauth_credentials_store = "keyring"'), skillExists, expectedMcp: arclayerMcpToml() };
}
