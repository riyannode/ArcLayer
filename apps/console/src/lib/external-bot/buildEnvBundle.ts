/**
 * Build environment file bundles for external bot runtimes.
 *
 * Generates .env.common and per-role .env files for PM2/Docker/custom runtimes.
 *
 * agentId consistency (fix #3):
 *   - ARCLAYER_AGENT_ID = minted ERC-8004 token ID (matches key agentId)
 *   - RUNTIME_ID = branded name as prefix (e.g. signal-oracle-runtime-01)
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
  /** Branded names for RUNTIME_ID prefix (e.g. signal-oracle). If omitted, falls back to agentId. */
  runtimeNames?: string[];
  payoutAddress?: string;
}): EnvBundle {
  const { template, baseUrl, category, agentIds, apiKeys, erc8004Ids, runtimeNames, payoutAddress } = input;

  const isErc8183 = template.id === 'erc8183-escrow-bots';

  // ── .env.common ──────────────────────────────────────────────
  // ERC-8183 bots load per-directory .env — .env.common is informational only
  if (isErc8183) {
    const common = {
      filename: '.env.common',
      content: [
        '# ERC-8183 bots load .env from their own directory.',
        '# Each role has a self-contained env file — see below.',
        '# Shared vars (ARCLAYER_BASE_URL, ARC_RPC_URL) are duplicated into each role file.',
        '# Cross-role IDs (PROVIDER_AGENT_ID, WORKER_AGENT_ID, EVALUATOR_AGENT_ID) are in the client .env file.',
        '',
      ].join('\n'),
    };

    // ── Per-role .env files (self-contained, per directory) ────
    const roleFiles: EnvKeyPair[] = template.roles.map((role, idx) => {
      const agentId = agentIds[idx] || role.defaultAgentId;
      const apiKey = apiKeys[idx] || '';
      const erc8004 = erc8004Ids[idx] || '';

      // Self-contained env: each bot loads __dirname + '/.env'
      const lines: string[] = [
        `# ${role.displayName} — ERC-8183`,
        `ARCLAYER_BASE_URL=${baseUrl}`,
        `ARCLAYER_API_KEY=${apiKey}`,
        `ARCLAYER_AGENT_ID=${agentId}`,
        `AGENT_CATEGORY=${category}`,
        `ARC_RPC_URL=https://rpc.testnet.arc.network`,
        `AUTONOMOUS_TX=true`,
      ];
      if (erc8004) lines.push(`ARCLAYER_ERC8004_ID=${erc8004}`);

      if (role.botRole === 'client') {
        const providerAgentId = agentIds[1] || template.roles[1]?.defaultAgentId || '';
        const evaluatorAgentId = agentIds[2] || template.roles[2]?.defaultAgentId || '';
        lines.push(
          `BUYER_AGENT_ID=${agentId}`,
          `# Paste your Arc Testnet address:`,
          `# CLIENT_ADDRESS=<your-0x-address>`,
          `# Paste your Arc Testnet private key:`,
          `# CLIENT_PRIVATE_KEY=<paste-on-vps>`,
          `# ── Cross-role: provider/worker ──`,
          `PROVIDER_AGENT_ID=${providerAgentId}`,
          `WORKER_AGENT_ID=${providerAgentId}`,
          `WORKER_ID=${providerAgentId}`,
          `# Paste the provider's Arc address:`,
          `# PROVIDER_ADDRESS=<provider-0x-address>`,
          `# WORKER_ADDRESS=<provider-0x-address>`,
          `# ── Cross-role: evaluator ──`,
          `EVALUATOR_AGENT_ID=${evaluatorAgentId}`,
          `# Paste the evaluator's Arc address:`,
          `# EVALUATOR_ADDRESS=<evaluator-0x-address>`,
          `JOB_BUDGET_ATOMIC=1000000`,
          `JOB_EXPIRY_SECONDS=86400`,
          `JOB_CREATE_INTERVAL_MS=60000`,
          `MAX_JOBS_PER_RUN=0`,
          `MAX_OPEN_JOBS=5`,
        );
      }

      if (role.botRole === 'provider') {
        lines.push(
          `# Worker is the user-facing name. PROVIDER_* is the legacy runtime env key.`,
          `PROVIDER_AGENT_ID=${agentId}`,
          `WORKER_AGENT_ID=${agentId}`,
          `WORKER_ID=${agentId}`,
          `# Worker aliases (placeholders — paste actual values on VPS):`,
          `# WORKER_ADDRESS=<your-0x-address>`,
          `# WORKER_PRIVATE_KEY=<paste-on-vps>`,
          `# Paste your Arc Testnet address:`,
          `# PROVIDER_ADDRESS=<your-0x-address>`,
          `# Paste your Arc Testnet private key:`,
          `# PROVIDER_PRIVATE_KEY=<paste-on-vps>`,
          `JOB_POLL_INTERVAL_MS=5000`,
          `CLAIM_TTL_SECONDS=600`,
          `MAX_ACTIVE_JOBS=3`,
        );
      }

      if (role.botRole === 'evaluator') {
        lines.push(
          `EVALUATOR_AGENT_ID=${agentId}`,
          `# Paste your Arc Testnet address:`,
          `# EVALUATOR_ADDRESS=<your-0x-address>`,
          `# Paste your Arc Testnet private key:`,
          `# EVALUATOR_PRIVATE_KEY=<paste-on-vps>`,
          `JOB_POLL_INTERVAL_MS=5000`,
          `EVALUATOR_MODE=rules`,
          `MAX_ACTIVE_JOBS=3`,
        );
      }

      // filename: client-bot/.env, provider-bot/.env, evaluator-bot/.env
      const filename = `${role.botRole}-bot/.env`;

      return { role: role.roleId, filename, content: lines.join('\n') + '\n' };
    });

    return { common, roleFiles };
  }

  // ── Non-ERC-8183: standard .env.common + per-role ────────────
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

  commonLines.push('# ARCLAYER_API_KEY is per-role — see .env.<role> files');
  commonLines.push('# LLM API key — paste your own:');
  commonLines.push('# LLM_API_KEY=<your-api-key>');
  commonLines.push('# LLM_PROVIDER=openai');
  commonLines.push('# LLM_MODEL=gpt-4o');
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
