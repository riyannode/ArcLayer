import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/mcp-connect/plugin');

describe('ArcLayer Codex plugin bundle', () => {
  it('ships the plugin manifest, MCP config, and Agent Bundle skill', () => {
    const pluginPath = resolve(pluginRoot, '.codex-plugin/plugin.json');
    const mcpPath = resolve(pluginRoot, '.mcp.json');
    const skillPath = resolve(pluginRoot, 'skills/arclayer-agent-bundle/SKILL.md');

    expect(existsSync(pluginPath)).toBe(true);
    expect(existsSync(mcpPath)).toBe(true);
    expect(existsSync(skillPath)).toBe(true);

    const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
    const skill = readFileSync(skillPath, 'utf8');

    expect(plugin.name).toBe('arclayer');
    expect(plugin.interface.defaultPrompt.join('\n')).toContain('After I mint in the browser');
    expect(mcp.mcp_servers.arclayer.enabled_tools).toContain('onboarding.start_agent_bundle');
    expect(mcp.mcp_servers.arclayer.enabled_tools).toContain('onboarding.get_agent_bundle_status');
    expect(mcp.mcp_servers.arclayer.enabled_tools).toContain('onboarding.create_agent_runtime_key');
    expect(skill).toContain('Never ask for private keys.');
    expect(skill).toContain('Runner, bot runtime, wallet payer, Gateway balance, ERC-8183 execution, and x402 execution are configured later.');
  });
});
