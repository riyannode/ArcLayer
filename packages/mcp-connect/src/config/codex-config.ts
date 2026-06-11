export const MCP_URL = 'https://arclayers.xyz/api/mcp';
export const SCOPES = ['arclayer:read','agents:read','jobs:read','jobs:prepare','tx:request','provider:runtime'] as const;
export const TOOLS = [
  'protocol.status','agents.discover','jobs.list_public','jobs.get_public',
  'onboarding.list_role_presets','onboarding.start_agent_bundle','onboarding.get_agent_bundle_status','onboarding.create_agent_runtime_key',
  'client.request_create_job_web_sign','client.request_fund_job_web_sign','client.request_complete_job_web_sign','client.get_signing_request_status',
  'provider.runtime_get_context','provider.runtime_heartbeat','provider.runtime_start_job','provider.runtime_write_checkpoint',
] as const;

function list(values: readonly string[]) { return ['[', ...values.map((v) => `  ${JSON.stringify(v)},`), ']'].join('\n'); }

export function arclayerMcpToml(): string {
  return [
    '[mcp_servers.arclayer]',
    `url = ${JSON.stringify(MCP_URL)}`,
    'enabled = true',
    'tool_timeout_sec = 60',
    'default_tools_approval_mode = "prompt"',
    `oauth_resource = ${JSON.stringify(MCP_URL)}`,
    `scopes = ${list(SCOPES)}`,
    `enabled_tools = ${list(TOOLS)}`,
  ].join('\n');
}

export function arclayerSkillToml(skillPath: string): string {
  return ['[[skills.config]]', `path = ${JSON.stringify(skillPath)}`, 'enabled = true'].join('\n');
}

export function arclayerSkillsToml(skillPaths: readonly string[]): string {
  return skillPaths.map(arclayerSkillToml).join('\n\n');
}
