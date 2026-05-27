/**
 * Generate ready-to-copy PM2 install commands for external bot runtimes.
 *
 * (fix #4) Only prediction-market-pm2-bridge produces a real command.
 * Generic/other templates return a "coming soon" instruction.
 */

import type { ExternalBotTemplate } from './templates';
import type { EnvBundle } from './buildEnvBundle';
import { formatEnvBundleAsInstallCommands } from './buildEnvBundle';

export type InstallCommand = {
  title: string;
  command: string;
};

export function buildInstallCommand(input: {
  template: ExternalBotTemplate;
  envBundle: EnvBundle;
  roleNames: string[];
}): InstallCommand {
  const { template, envBundle, roleNames } = input;

  if (template.id === 'prediction-market-pm2-bridge') {
    return buildPM2MarketBridgeCommand(envBundle);
  }

  if (template.id === 'erc8183-escrow-bots') {
    return buildERC8183EscrowCommand(envBundle);
  }

  // (fix #6) Non-PM2 templates = coming soon
  return buildComingSoonCommand(template);
}

function buildPM2MarketBridgeCommand(envBundle: EnvBundle): InstallCommand {
  const envSnippets = formatEnvBundleAsInstallCommands(envBundle);
  const cmd = `# ── Prediction Market PM2 Bridge ──────────────────────────
git clone https://github.com/riyannode/ArcLayer.git
cd ArcLayer/examples/external-pm2-bots/market-agent-bridge

# ── Env files ─────────────────────────────────────────
${envSnippets}

# ── Install dependencies ──────────────────────────────
npm install

# ── Install PM2 (if missing) ──────────────────────────
npm install -g pm2 2>/dev/null || true

# ── Start processes ───────────────────────────────────
pm2 delete oracle-bot analyzer-bot evaluator-bot executor-bot 2>/dev/null || true
pm2 start ecosystem.independent.config.cjs
pm2 save

# ── Check status ──────────────────────────────────────
pm2 status
`;

  return { title: 'PM2 — market-agent-bridge', command: cmd.trim() };
}

function buildERC8183EscrowCommand(envBundle: EnvBundle): InstallCommand {
  const envSnippets = formatEnvBundleAsInstallCommands(envBundle);
  const cmd = `# ── ERC-8183 Escrow Job Bots ────────────────────────────
git clone https://github.com/riyannode/ArcLayer.git
cd ArcLayer/examples/external-erc8183-bots

# ── Env files ─────────────────────────────────────────
${envSnippets}

# ── Install dependencies ──────────────────────────────
npm install

# ── Install PM2 (if missing) ──────────────────────────
npm install -g pm2 2>/dev/null || true

# ── Start processes ───────────────────────────────────
pm2 delete client-bot provider-bot evaluator-bot 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

# ── Check status ──────────────────────────────────────
pm2 status
`;
  return { title: 'PM2 — erc8183-escrow-bots', command: cmd.trim() };
}

function buildComingSoonCommand(template: ExternalBotTemplate): InstallCommand {
  const cmd = `# ── ${template.name} ──────────────────────────
# Template runtime is not yet available for automated deployment.
#
# To run this bot manually:
# 1. Clone https://github.com/riyannode/ArcLayer.git
# 2. cd examples/external-erc8183-bots/<YOUR_BOT_DIR>
# 3. Create .env files with the values shown above
# 4. Create an ecosystem.config.cjs for PM2
# 5. npm install && pm2 start ecosystem.config.cjs
#
# For help, open an issue or use the Custom Worker template.
`;

  return { title: `${template.name} — coming soon`, command: cmd.trim() };
}
