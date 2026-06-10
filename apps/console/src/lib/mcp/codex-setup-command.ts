export type CodexSetupConfig = {
  ARCLAYER_MCP_URL: string;
  ARCLAYER_MCP_TOKEN: string;
};

const ARCLAYER_MCP_TOOLS = [
  'protocol.status',
  'agents.discover',
  'onboarding.list_role_presets',
  'onboarding.start_agent_bundle',
  'onboarding.get_agent_bundle_status',
  'onboarding.create_agent_runtime_key',
] as const;

export function powershellEscape(value: string) {
  return value.replace(/`/g, '``').replace(/"/g, '`"');
}

export function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function tomlBlock(url: string) {
  return [
    '[mcp_servers.arclayer]',
    `url = "${url}"`,
    'bearer_token_env_var = "ARCLAYER_MCP_TOKEN"',
    'tool_timeout_sec = 60',
    'enabled = true',
    'default_tools_approval_mode = "prompt"',
    'enabled_tools = [',
    ...ARCLAYER_MCP_TOOLS.map((tool) => `  "${tool}",`),
    ']',
  ].join('\n');
}

export function buildPowerShellCodexSetup(config: CodexSetupConfig) {
  const url = powershellEscape(config.ARCLAYER_MCP_URL);
  const token = powershellEscape(config.ARCLAYER_MCP_TOKEN);
  const block = tomlBlock(url);

  return [
    `$cfgDir = Join-Path $HOME ".codex"`,
    `New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null`,
    `$cfg = Join-Path $cfgDir "config.toml"`,
    `$block = @"`,
    block,
    `"@`,
    `if (Test-Path $cfg) {`,
    `  $existing = Get-Content $cfg -Raw`,
    `  if ($existing -notmatch '\\[mcp_servers\\.arclayer\\]') {`,
    `    Add-Content -Path $cfg -Value ("\`n" + $block)`,
    `  }`,
    `} else {`,
    `  Set-Content -Path $cfg -Value $block`,
    `}`,
    `[Environment]::SetEnvironmentVariable("ARCLAYER_MCP_TOKEN", "${token}", "User")`,
    `$env:ARCLAYER_MCP_TOKEN = "${token}"`,
    `Write-Host "ArcLayer Codex auth configured. Restart Codex or open a new terminal, then run: codex"`,
  ].join('\n');
}

export function buildBashCodexSetup(config: CodexSetupConfig) {
  const url = config.ARCLAYER_MCP_URL;
  const token = shellEscape(config.ARCLAYER_MCP_TOKEN);
  const block = tomlBlock(url);

  return [
    `mkdir -p "$HOME/.codex"`,
    `touch "$HOME/.codex/config.toml"`,
    `if ! grep -q '^\\[mcp_servers\\.arclayer\\]' "$HOME/.codex/config.toml"; then`,
    `cat >> "$HOME/.codex/config.toml" <<'TOML_ARCLAYER'`,
    ``,
    block,
    `TOML_ARCLAYER`,
    `fi`,
    `if ! grep -q '^export ARCLAYER_MCP_TOKEN=' "$HOME/.profile" 2>/dev/null; then`,
    `  echo "export ARCLAYER_MCP_TOKEN=${token}" >> "$HOME/.profile"`,
    `else`,
    `  sed -i.bak "s|^export ARCLAYER_MCP_TOKEN=.*|export ARCLAYER_MCP_TOKEN=${token}|" "$HOME/.profile"`,
    `fi`,
    `export ARCLAYER_MCP_TOKEN=${token}`,
    `echo "ArcLayer Codex auth configured. Restart Codex or open a new terminal, then run: codex"`,
  ].join('\n');
}
