import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

function expectRequiredConfig(command: string) {
  expect(command).toContain('[mcp_servers.arclayer]');
  expect(command).toContain('bearer_token_env_var = "ARCLAYER_MCP_TOKEN"');
  requiredTools.forEach((tool) => expect(command).toContain(tool));
}

function runBashSetup(shell: '/bin/bash' | '/bin/zsh') {
  const home = mkdtempSync(join(tmpdir(), 'arclayer-codex-'));
  const codexDir = join(home, '.codex');
  execFileSync('mkdir', ['-p', codexDir]);
  writeFileSync(join(codexDir, 'config.toml'), [
    '[model]',
    'name = "keep-me"',
    '',
    '[mcp_servers.arclayer]',
    'url = "https://stale.example/mcp"',
    'enabled = false',
    '',
    '[mcp_servers.other]',
    'url = "https://other.example/mcp"',
  ].join('\n'));

  const script = join(home, 'setup.sh');
  writeFileSync(script, buildBashCodexSetup(config));
  execFileSync('bash', ['-n', script]);
  execFileSync('bash', [script], { env: { ...process.env, HOME: home, SHELL: shell } });
  return home;
}

describe('Codex setup commands', () => {
  it('builds a PowerShell command that replaces the existing ArcLayer section', () => {
    const command = buildPowerShellCodexSetup(config);

    expectRequiredConfig(command);
    expect(command).toContain("$skipping = $true");
    expect(command).toContain("$line -match '^\\[mcp_servers\\.arclayer\\]\\s*$'");
    expect(command).toContain('$nl = [Environment]::NewLine');
    expect(command).toContain('$output -join $nl');
    expect(command).toContain('$existing + $nl + $nl + $block + $nl');
    expect(command).toContain('$block + $nl');
    expect(command).toContain('Set-Content -Path $cfg -Value $content -NoNewline');
    expect(command).not.toContain('-join "n"');
    expect(command).not.toContain('+ "nn"');
    expect(command).not.toContain('+ "n"');
    expect(command).not.toContain('$existing -notmatch');
    expect(command).toContain('SetEnvironmentVariable("ARCLAYER_MCP_TOKEN"');
  });

  it('builds valid Bash that replaces the stale ArcLayer section', () => {
    const command = buildBashCodexSetup(config);
    expectRequiredConfig(command);
    expect(command).toContain('/^\\[mcp_servers\\.arclayer\\][[:space:]]*$/');

    const home = runBashSetup('/bin/bash');
    const codexConfig = readFileSync(join(home, '.codex/config.toml'), 'utf8');
    expect(codexConfig).toContain('[model]');
    expect(codexConfig).toContain('[mcp_servers.other]');
    expect(codexConfig).not.toContain('https://stale.example/mcp');
    expect(codexConfig.match(/\[mcp_servers\.arclayer\]/g)).toHaveLength(1);
  });

  it('persists the token to zsh startup files', () => {
    const home = runBashSetup('/bin/zsh');
    expect(readFileSync(join(home, '.zshrc'), 'utf8')).toContain('export ARCLAYER_MCP_TOKEN=mcp_test_token');
    expect(readFileSync(join(home, '.zprofile'), 'utf8')).toContain('export ARCLAYER_MCP_TOKEN=mcp_test_token');
  });

  it('persists the token to bash startup files', () => {
    const home = runBashSetup('/bin/bash');
    expect(readFileSync(join(home, '.bashrc'), 'utf8')).toContain('export ARCLAYER_MCP_TOKEN=mcp_test_token');
    expect(readFileSync(join(home, '.profile'), 'utf8')).toContain('export ARCLAYER_MCP_TOKEN=mcp_test_token');
  });
});
