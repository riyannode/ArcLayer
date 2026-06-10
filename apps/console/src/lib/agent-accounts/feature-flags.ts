export function isAgentAccountServerRailEnabled(): boolean {
  return process.env.AGENT_ACCOUNT_RAILS_ENABLED === 'true';
}

export function isAgentAccountClientRailEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AGENT_ACCOUNT_RAILS_ENABLED === 'true';
}

export function isMcpAgentAccountIdentityEnabled(): boolean {
  return (
    process.env.AGENT_ACCOUNT_RAILS_ENABLED === 'true' &&
    process.env.MCP_AGENT_ACCOUNT_IDENTITY_ENABLED === 'true'
  );
}

export function isAgentAccountRuntimePayerEnabled(): boolean {
  return (
    process.env.AGENT_ACCOUNT_RAILS_ENABLED === 'true' &&
    process.env.AGENT_ACCOUNT_AS_RUNTIME_PAYER_ENABLED === 'true'
  );
}

export function isAgentAccountA2aAutoBindEnabled(): boolean {
  return (
    process.env.AGENT_ACCOUNT_RAILS_ENABLED === 'true' &&
    process.env.AGENT_ACCOUNT_A2A_AUTO_BIND_ENABLED === 'true'
  );
}
