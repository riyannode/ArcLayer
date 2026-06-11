/**
 * arclayer-runner install — install MCP STDIO sidecar into LLM runtime config.
 *
 * Usage:
 *   arclayer-runner install --target hermes --mode stdio
 *   arclayer-runner install --target openclaw --mode stdio
 *
 * Safe by default:
 * - Backs up before writing
 * - Deep merges mcpServers (never overwrites other keys)
 * - Prints manual config if path unknown
 */

import { Command } from "commander";
import { getInstaller, buildMcpServerConfig, formatManualMcpConfig, detectAllRuntimes } from "./installers/auto";
import type { InstallTarget } from "./installers/types";

export function registerInstallCommand(program: Command): void {
  program
    .command("install")
    .description("Install ArcLayer Runner MCP STDIO sidecar into LLM runtime config")
    .requiredOption("--target <runtime>", "Target runtime: hermes, openclaw")
    .option("--mode <mode>", "MCP transport mode", "stdio")
    .action(async (opts) => {
      const target = opts.target as InstallTarget;

      if (!["hermes", "openclaw"].includes(target)) {
        console.error(`❌ Unknown target: ${target}. Expected: hermes, openclaw`);
        process.exit(1);
      }

      if (opts.mode !== "stdio") {
        console.error(`❌ Unknown mode: ${opts.mode}. Expected: stdio`);
        process.exit(1);
      }

      try {
        const installer = getInstaller(target);
        const mcpConfig = buildMcpServerConfig();

        console.log(`Installing ArcLayer Runner MCP into ${target}...\n`);

        const result = await installer.install(mcpConfig);

        if (result.action === "installed") {
          console.log(`✅ ${result.message}\n`);
          console.log(`MCP server config injected:`);
          console.log(`  command: ${mcpConfig.command} ${mcpConfig.args.join(" ")}`);
          console.log(`  env.ARCLAYER_RUNNER_CONFIG: ${mcpConfig.env?.ARCLAYER_RUNNER_CONFIG}`);
          console.log(`  env.ARCLAYER_RUNNER_POLICY: ${mcpConfig.env?.ARCLAYER_RUNNER_POLICY}`);
        } else if (result.action === "manual") {
          console.log(`⚠️  ${result.message}\n`);
          console.log(`Add this to your ${target} MCP config:\n`);
          console.log(formatManualMcpConfig(mcpConfig));
        } else {
          console.log(`⚠️  ${result.message}`);
        }

        if (result.backupPath) {
          console.log(`\nBackup saved: ${result.backupPath}`);
        }

        console.log(`\nNext: run arclayer-runner doctor to verify.`);
      } catch (error: any) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
      }
    });

  // ── install detect (show detected runtimes) ──────────────────────────
  program
    .command("install-detect")
    .description("Detect installed LLM runtimes")
    .action(() => {
      const runtimes = detectAllRuntimes();

      console.log("Detected runtimes:\n");
      for (const rt of runtimes) {
        const icon = rt.installed ? "✅" : "❌";
        const status = rt.installed ? `Found: ${rt.configPath}` : "Not found";
        console.log(`${icon} ${rt.target}: ${status}`);
      }

      const detected = runtimes.filter((r) => r.installed);
      if (detected.length === 0) {
        console.log("\nNo runtimes detected. Use manual MCP config block.");
        const mcpConfig = buildMcpServerConfig();
        console.log(formatManualMcpConfig(mcpConfig));
      }
    });
}
