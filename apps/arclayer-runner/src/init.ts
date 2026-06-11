/**
 * arclayer-runner init — non-interactive scaffolding command.
 *
 * Creates config.json, policy.json, receipts.jsonl, ledger.jsonl
 * in ~/.arclayer/runner/ from CLI flags.
 *
 * CI-friendly. No prompts. Refuses to overwrite without --force.
 */

import { Command } from "commander";
import { writeRunnerConfig, type WriteConfigInput } from "./config-writer";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Scaffold runner config files (non-interactive, CI-friendly)")
    .requiredOption("--agent-id <id>", "Agent ID (required)")
    .option("--target <runtime>", "Runtime target: hermes, openclaw, custom", "openclaw")
    .option("--role <role>", "Runner role: provider, client, evaluator, x402-agent, identity-agent, validation-agent, devops-admin, full-stack-agent", "provider")
    .option("--wallet <address>", "Circle wallet address (0x...)")
    .option("--chain <chain>", "Circle chain", "BASE")
    .option("--cli-bin <path>", "Circle CLI binary path", "circle")
    .option("--per-tx <usdc>", "Per-transaction limit (USDC)", "0.01")
    .option("--daily <usdc>", "Daily spending limit (USDC)", "1")
    .option("--monthly <usdc>", "Monthly spending limit (USDC)", "20")
    .option("--batch-max-items <n>", "Max items per batch", "10")
    .option("--batch-max-total <usdc>", "Max batch total (USDC)", "0.05")
    .option(
      "--allowed-x402-host <host>",
      "Allowed x402 host (repeatable)",
      collectHosts,
      []
    )
    .option("--payment-enabled", "Enable payments", false)
    .option("--force", "Overwrite existing config/policy files", false)
    .action(async (opts) => {
      try {
        const input: WriteConfigInput = {
          agentId: opts.agentId,
          role: opts.role,
          walletAddress: opts.wallet,
          chain: opts.chain,
          cliBin: opts.cliBin,
          runtimeTarget: opts.target,
          paymentEnabled: opts.paymentEnabled,
          perTxLimitUsdc: opts.perTx,
          dailyLimitUsdc: opts.daily,
          monthlyLimitUsdc: opts.monthly,
          batchMaxItems: parseInt(opts.batchMaxItems, 10),
          batchMaxTotalUsdc: opts.batchMaxTotal,
          allowedX402Hosts: opts.allowedX402Host,
          runnerId: `runner-${opts.agentId}`,
          agentAddress: opts.wallet || "0x0000000000000000000000000000000000000000"
        };

        const result = await writeRunnerConfig(input, { force: opts.force });

        console.log("✅ ArcLayer Runner config initialized\n");
        console.log(`Agent:     ${result.config.agentId}`);
        console.log(`Role:      ${result.config.role}`);
        console.log(`Runtime:   ${result.config.runtime.target}`);
        console.log(`Chain:     ${result.config.circle.chain}`);
        console.log(`Wallet:    ${result.config.circle.walletAddress ?? "(not set)"}`);
        console.log(`Payment:   ${result.policy.paymentEnabled ? "enabled" : "disabled"}`);
        console.log(`\nCreated files:`);
        for (const f of result.created) {
          console.log(`  ${f}`);
        }
        if (result.skipped.length > 0) {
          console.log(`\nSkipped (already exist):`);
          for (const f of result.skipped) {
            console.log(`  ${f}`);
          }
        }
        console.log(`\nNext steps:`);
        console.log(`  1. Set ARCLAYER_RUNNER_SECRET env var (16+ chars) for HTTP mode`);
        console.log(`  2. Run: arclayer-runner doctor`);
        console.log(`  3. Run: arclayer-runner mcp (STDIO) or arclayer-runner start (HTTP)`);
      } catch (error: any) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
      }
    });
}

/**
 * Collect repeated --allowed-x402-host flags into an array.
 */
function collectHosts(value: string, previous: string[]): string[] {
  return [...previous, value];
}
