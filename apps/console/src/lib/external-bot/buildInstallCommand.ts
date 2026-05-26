/**
 * Generate ready-to-copy PM2 install commands for external bot runtimes.
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

  return buildGenericPM2Command(envBundle, roleNames);
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

function buildGenericPM2Command(envBundle: EnvBundle, roleNames: string[]): InstallCommand {
  const envSnippets = formatEnvBundleAsInstallCommands(envBundle);
  const deleteCmd = roleNames.map((n) => `pm2 delete "${n}" 2>/dev/null`).join('; ');
  const startCmd = roleNames
    .map((n) => `  pm2 start ecosystem.config.cjs --only "${n}"`)
    .join(' \\\n');

  const cmd = `# ── Generic PM2 Runtime ─────────────────────────────
git clone https://github.com/riyannode/ArcLayer.git
cd ArcLayer/examples/external-erc8183-bots/<YOUR_BOT_DIR>

${envSnippets}

npm install
npm install -g pm2 2>/dev/null || true
${deleteCmd} || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
`;

  return { title: 'PM2 — generic runtime', command: cmd.trim() };
}
