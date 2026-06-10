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
    `$lines = if (Test-Path $cfg) { Get-Content $cfg } else { @() }`,
    `$output = [System.Collections.Generic.List[string]]::new()`,
    `$skipping = $false`,
    `foreach ($line in $lines) {`,
    `  if ($line -match '^\\[mcp_servers\\.arclayer\\]\\s*$') {`,
    `    $skipping = $true`,
    `    continue`,
    `  }`,
    `  if ($skipping -and $line -match '^\\[[^\\]]+\\]\\s*$') {`,
    `    $skipping = $false`,
    `  }`,
    `  if (-not $skipping) {`,
    `    $output.Add($line)`,
    `  }`,
    `}`,
    `$existing = ($output -join "\`n").TrimEnd()`,
    `$content = if ($existing) { $existing + "\`n\`n" + $block + "\`n" } else { $block + "\`n" }`,
    `Set-Content -Path $cfg -Value $content -NoNewline`,
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
    `cfg_tmp="$(mktemp)"`,
    `awk '`,
    `  BEGIN { skipping = 0 }`,
    `  /^\\[mcp_servers\\.arclayer\\][[:space:]]*$/ { skipping = 1; next }`,
    `  skipping && /^\\[[^]]+\\][[:space:]]*$/ { skipping = 0 }`,
    `  !skipping { print }`,
    `' "$HOME/.codex/config.toml" > "$cfg_tmp"`,
    `cat "$cfg_tmp" > "$HOME/.codex/config.toml"`,
    `rm -f "$cfg_tmp"`,
    `cat >> "$HOME/.codex/config.toml" <<'TOML_ARCLAYER'`,
    ``,
    block,
    `TOML_ARCLAYER`,
    `TOKEN_VALUE=${token}`,
    `set_arclayer_token() {`,
    `  file="$1"`,
    `  mkdir -p "$(dirname "$file")"`,
    `  touch "$file"`,
    `  if grep -q '^export ARCLAYER_MCP_TOKEN=' "$file" 2>/dev/null; then`,
    `    sed -i.bak "s|^export ARCLAYER_MCP_TOKEN=.*|export ARCLAYER_MCP_TOKEN=${'${TOKEN_VALUE}'}|" "$file"`,
    `  else`,
    `    printf '\\nexport ARCLAYER_MCP_TOKEN=%s\\n' "${'${TOKEN_VALUE}'}" >> "$file"`,
    `  fi`,
    `}`,
    `case "${'${SHELL:-}'}" in`,
    `  *zsh*)`,
    `    set_arclayer_token "$HOME/.zshrc"`,
    `    set_arclayer_token "$HOME/.zprofile"`,
    `    ;;`,
    `  *bash*)`,
    `    set_arclayer_token "$HOME/.bashrc"`,
    `    set_arclayer_token "$HOME/.profile"`,
    `    ;;`,
    `  *)`,
    `    set_arclayer_token "$HOME/.profile"`,
    `    ;;`,
    `esac`,
    `export ARCLAYER_MCP_TOKEN="$TOKEN_VALUE"`,
    `echo "ArcLayer Codex auth configured. Restart Codex or open a new terminal, then run: codex"`,
  ].join('\n');
}
