export const TOOL_SCOPES: Record<string, string> = {
  'protocol.status':'arclayer:read','agents.discover':'agents:read','jobs.list_public':'jobs:read','jobs.get_public':'jobs:read',
  'onboarding.list_role_presets':'arclayer:read','onboarding.create_registration_draft':'jobs:prepare','onboarding.start_agent_bundle':'jobs:prepare','onboarding.get_agent_bundle_status':'jobs:read','onboarding.create_agent_runtime_key':'provider:runtime',
  'client.request_create_job_web_sign':'tx:request','client.request_fund_job_web_sign':'tx:request','client.request_complete_job_web_sign':'tx:request','client.request_reject_job_web_sign':'tx:request','client.request_claim_refund_web_sign':'tx:request','client.get_signing_request_status':'tx:request',
  'provider.runtime_get_context':'provider:runtime','provider.runtime_heartbeat':'provider:runtime','provider.runtime_start_job':'provider:runtime','provider.runtime_write_checkpoint':'provider:runtime',
};
export const PUBLIC_MCP_TOOLS = new Set(['protocol.status','protocol.health','agents.discover','agents.get','jobs.list_public','jobs.get_public','onboarding.list_role_presets']);

export function hasMcpScope(scopes: readonly string[], required?: string): boolean { return !required || scopes.includes('*') || scopes.includes(required); }
