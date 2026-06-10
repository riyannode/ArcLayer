import { Command } from 'commander';
import { installCodex, uninstallCodex } from './plugin/install-codex-plugin.js';
import { codexStatus } from './clients/codex.js';

function printResult(result: Awaited<ReturnType<typeof installCodex>>) {
  console.log(`Codex config: ${result.paths.codexConfig}`);
  if (result.backup) console.log(`Backup: ${result.backup}`);
  console.log(result.changed ? 'ArcLayer configuration updated.' : 'ArcLayer configuration already current.');
  console.log('Restart Codex, then approve ArcLayer OAuth in the browser if prompted.');
}

export async function run(argv = process.argv) {
  const program = new Command()
    .name('arclayer-codex')
    .description('Install ArcLayer OAuth-ready MCP config and Agent Bundle Skill for Codex.')
    .action(async () => {
      printResult(await installCodex({ withSkill: true }));
    });

  program
    .command('codex')
    .description('Install ArcLayer OAuth-ready MCP config only')
    .action(async () => printResult(await installCodex()));

  program
    .command('codex-plugin')
    .description('Install ArcLayer MCP config and Agent Bundle Skill')
    .action(async () => printResult(await installCodex({ withSkill: true })));

  program
    .command('status')
    .description('Inspect local ArcLayer Codex MCP installation')
    .action(async () => {
      const s = await codexStatus();
      console.log(JSON.stringify({
        configPath: s.paths.codexConfig,
        configExists: s.configExists,
        arclayerMcp: s.mcpConfigured,
        skillPath: s.paths.skillDir,
        skillExists: s.skillExists,
      }, null, 2));
    });

  program
    .command('uninstall <client>')
    .description('Remove ArcLayer entries from a supported client')
    .action(async (client) => {
      if (client !== 'codex') throw new Error('Only Codex uninstall is supported.');
      const r = await uninstallCodex();
      console.log(`Codex config: ${r.paths.codexConfig}`);
      if (r.backup) console.log(`Backup: ${r.backup}`);
      console.log(r.changed ? 'ArcLayer Codex entries removed.' : 'No ArcLayer Codex entries found.');
    });

  await program.parseAsync(argv);
}
