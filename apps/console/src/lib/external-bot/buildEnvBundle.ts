/**
 * Build environment file bundles for external bot runtimes.
 *
 * Generates .env.common and per-role .env files for PM2/Docker/custom runtimes.
 *
 * agentId consistency (fix #3):
 *   - ARCLAYER_AGENT_ID = minted ERC-8004 token ID (matches key agentId)
 *   - RUNTIME_ID = branded name as prefix (e.g. hermes-oracle-runtime-01)
 *   - ARCLAYER_ERC8004_ID = full on-chain reference
 */

import type { ExternalBotTemplate } from './templates';

export type EnvKeyPair = { role: string; filename: string; content: string };

export type EnvBundle = {
  common: { filename: string; content: string };
  roleFiles: EnvKeyPair[];
};

export function buildEnvBundle(input: {
  template: ExternalBotTemplate;
  baseUrl: string;
  category: string;
  agentIds: string[];
  apiKeys: string[];
  erc8004Ids: string[];
  /** Branded names for RUNTIME_ID prefix (e.g. hermes-oracle). If omitted, falls back to agentId. */
  runtimeNames?: string[];
  liveEventsToken?: string;
  payoutAddress?: string;
}): EnvBundle {
  const { template, baseUrl, category, agentIds, apiKeys, erc8004Ids, runtimeNames, liveEventsToken, payoutAddress } = input;

  // ── .env.common ──────────────────────────────────────────────
  const commonLines: string[] = [
    `ARCLAYER_BASE_URL=${baseUrl}`,
    `AGENT_CATEGORY=${category}`,
    'MARKET_EXECUTION_MODE=DRY_RUN',
    'PROTOCOL_TX_MODE=ARC_TESTNET',
    'X402_AUTOPAY=true',
    'X402_AUTOPAY_REQUIRED=false',
    'X402_SCOPE=external_trace',
    'BOT_INTERVAL_MS=900000',
  ];
  if (liveEventsToken) commonLines.push(`A2A_LIVE_EVENTS_TOKEN=${liveEventsToken}`);
  commonLines.push('# Paste X402_PAYER_PRIVATE_KEY on your VPS — never in browser');
  commonLines.push('# X402_PAYER_PRIVATE_KEY=<paste-on-vps>');

  const common = {
    filename: '.env.common',
    content: commonLines.join('\n') + '\n',
  };

  // ── Per-role .env files ──────────────────────────────────────
  const roleFiles: EnvKeyPair[] = template.roles.map((role, idx) => {
    // (fix #3) ARCLAYER_AGENT_ID = minted token ID (matches key)
    const agentId = agentIds[idx] || role.defaultAgentId;
    // (fix #4) RUNTIME_ID uses branded name prefix, not token ID
    const runtimeName = runtimeNames?.[idx] || role.defaultAgentId;
    const apiKey = apiKeys[idx] || '';
    const erc8004 = erc8004Ids[idx] || '';
    const roleName = template.fixedBotRoleNames ? role.botRole : role.roleId;

    const lines: string[] = [
      `BOT_ROLE=${role.botRole}`,
      `ARCLAYER_AGENT_ID=${agentId}`,
      `ARCLAYER_API_KEY=${apiKey}`,
      `RUNTIME_ID=${runtimeName}-runtime-01`,
      `AGENT_CATEGORY=${category}`,
    ];
    if (erc8004) lines.push(`ARCLAYER_ERC8004_ID=${erc8004}`);
    if (payoutAddress) lines.push(`X402_RECEIVER_ADDRESS=${payoutAddress}`);

    const filename = template.fixedBotRoleNames
      ? `.env.${role.botRole}`
      : `.env.${role.roleId}`;

    return { role: role.roleId, filename, content: lines.join('\n') + '\n' };
  });

  return { common, roleFiles };
}

export function formatEnvBundleAsInstallCommands(bundle: EnvBundle): string {
  const lines: string[] = [];

  // Create .env.common
  lines.push(`cat > .env.common <<'EOF'\n${bundle.common.content.trim()}\nEOF`);

  // Create role files
  for (const rf of bundle.roleFiles) {
    lines.push(`cat > ${rf.filename} <<'EOF'\n${rf.content.trim()}\nEOF`);
  }

  return lines.join('\n\n') + '\n';
}
