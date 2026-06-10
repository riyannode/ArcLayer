import { describe, expect, it } from 'vitest';
import {
  buildBashCodexSetup,
  buildPowerShellCodexSetup,
} from './codex-setup-command';

const config = {
  ARCLAYER_MCP_URL: 'https://arclayers.xyz/api/mcp',
  ARCLAYER_MCP_TOKEN: 'mcp_test_token',
};

const requiredTools = [
  'onboarding.start_agent_bundle',
  'onboarding.get_agent_bundle_status',
  'onboarding.create_agent_runtime_key',
];

describe('Codex setup commands', () => {
  it('builds the PowerShell setup command', () => {
    const command = buildPowerShellCodexSetup(config);

    expect(command).toContain('[mcp_servers.arclayer]');
    expect(command).toContain('bearer_token_env_var = "ARCLAYER_MCP_TOKEN"');
    requiredTools.forEach((tool) => expect(command).toContain(tool));
    expect(command).toContain('SetEnvironmentVariable("ARCLAYER_MCP_TOKEN"');
  });

  it('builds an idempotent Bash setup command', () => {
    const command = buildBashCodexSetup(config);

    expect(command).toContain('[mcp_servers.arclayer]');
    expect(command).toContain('bearer_token_env_var = "ARCLAYER_MCP_TOKEN"');
    requiredTools.forEach((tool) => expect(command).toContain(tool));
    expect(command).toContain('export ARCLAYER_MCP_TOKEN=');
    expect(command).toContain("if ! grep -q '^\\[mcp_servers\\.arclayer\\]'");
  });
});
