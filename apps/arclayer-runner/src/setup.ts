/**
 * arclayer-runner setup — interactive wizard for first-time configuration.
 *
 * Asks questions via stdin prompts, then delegates to writeRunnerConfig()
 * (same writer as init). No file-writing duplication.
 *
 * Phase 2: Does NOT install Hermes/OpenClaw config. Prints manual instructions.
 */

import { Command } from "commander";
import { createInterface } from "node:readline";
import { validateWalletAddress } from "@arclayer/runner-core";
import { writeRunnerConfig, type WriteConfigInput } from "./config-writer";

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function askChoice(
  rl: ReturnType<typeof createInterface>,
  question: string,
  choices: string[],
  defaultChoice: string
): Promise<string> {
  const display = choices.map((c) => (c === defaultChoice ? `[${c}]` : c)).join(" / ");
  return new Promise(async (resolve) => {
    const answer = await ask(rl, `${question} (${display}): `);
    if (!answer) return resolve(defaultChoice);
    const match = choices.find((c) => c.toLowerCase() === answer.toLowerCase());
    if (match) return resolve(match);
    console.log(`  Invalid choice. Expected: ${choices.join(", ")}`);
    resolve(askChoice(rl, question, choices, defaultChoice));
  });
}

function askOptional(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultValue: string
): Promise<string> {
  return new Promise(async (resolve) => {
    const answer = await ask(rl, `${question} [${defaultValue}]: `);
    resolve(answer || defaultValue);
  });
}

function askYesNo(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultYes: boolean
): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise(async (resolve) => {
    const answer = await ask(rl, `${question} (${hint}): `);
    if (!answer) return resolve(defaultYes);
    resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
  });
}

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Interactive setup wizard for ArcLayer Runner")
    .action(async () => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout
      });

      try {
        console.log("═══════════════════════════════════════════════════");
        console.log("  ArcLayer Runner — Setup Wizard");
        console.log("═══════════════════════════════════════════════════\n");

        // ── 1. Target runtime ──────────────────────────────────────────
        console.log("▸ Runtime Configuration\n");
        const target = await askChoice(
          rl,
          "  Target runtime",
          ["hermes", "openclaw", "both"],
          "openclaw"
        );

        // "both" means openclaw (primary), hermes is secondary
        const runtimeTarget = target === "both" ? "openclaw" : target;

        // ── 2. Agent ID ────────────────────────────────────────────────
        const agentId = await ask(rl, "\n  Agent ID: ");
        if (!agentId) {
          console.error("❌ Agent ID is required.");
          process.exit(1);
        }

        // ── 3. Role ────────────────────────────────────────────────────
        const role = await askChoice(
          rl,
          "  Role",
          ["provider", "client", "evaluator"],
          "provider"
        );

        // ── 4. Circle wallet ───────────────────────────────────────────
        console.log("\n▸ Circle Wallet Configuration\n");
        console.log("  Enter your Circle wallet address (public, 0x...).");
        console.log("  NEVER enter private keys, seed phrases, or OTP here.\n");

        let walletAddress: string | undefined;
        while (true) {
          const input = await ask(rl, "  Wallet address (optional, press Enter to skip): ");
          if (!input) {
            walletAddress = undefined;
            break;
          }
          const check = validateWalletAddress(input);
          if (check.valid) {
            walletAddress = input;
            break;
          }
          console.log(`  ❌ ${check.error}\n`);
        }

        // ── 5. Chain ───────────────────────────────────────────────────
        const chain = await askOptional(rl, "\n  Circle chain", "ARC-TESTNET");

        // ── 6. Payment policy ──────────────────────────────────────────
        console.log("\n▸ Spending Policy\n");
        const paymentEnabled = await askYesNo(rl, "  Enable payments?", false);

        const perTxLimitUsdc = await askOptional(rl, "  Per-tx limit (USDC)", "0.01");
        const dailyLimitUsdc = await askOptional(rl, "  Daily limit (USDC)", "1");
        const monthlyLimitUsdc = await askOptional(rl, "  Monthly limit (USDC)", "20");
        const batchMaxItems = await askOptional(rl, "  Batch max items", "10");
        const batchMaxTotalUsdc = await askOptional(rl, "  Batch max total (USDC)", "0.05");

        // ── 7. Allowed x402 hosts ──────────────────────────────────────
        console.log("\n  Allowed x402 hosts (comma-separated, domain only, e.g. arclayers.xyz): ");
        const hostsInput = await ask(rl, "  ");
        const allowedX402Hosts = hostsInput
          ? hostsInput.split(",").map((h) => h.trim()).filter(Boolean)
          : [];

        rl.close();

        // ── 8. Write config ────────────────────────────────────────────
        console.log("\n═══════════════════════════════════════════════════");

        const input: WriteConfigInput = {
          agentId,
          role,
          walletAddress,
          chain,
          runtimeTarget,
          paymentEnabled,
          perTxLimitUsdc,
          dailyLimitUsdc,
          monthlyLimitUsdc,
          batchMaxItems: parseInt(batchMaxItems, 10),
          batchMaxTotalUsdc,
          allowedX402Hosts
        };

        const result = await writeRunnerConfig(input, { force: false });

        console.log("✅ ArcLayer Runner config created\n");
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

        // ── 9. MCP config block ────────────────────────────────────────
        console.log(`\n═══════════════════════════════════════════════════`);
        console.log(`  MCP STDIO Config (for Hermes / OpenClaw)`);
        console.log(`═══════════════════════════════════════════════════\n`);
        console.log(`  Add this to your Hermes or OpenClaw mcpServers config:\n`);
        console.log(
          JSON.stringify(
            {
              mcpServers: {
                "arclayer-runner": {
                  command: "npx",
                  args: ["-y", "@arclayer/runner", "mcp"],
                  env: {
                    ARCLAYER_RUNNER_CONFIG: result.paths.configFile,
                    ARCLAYER_RUNNER_POLICY: result.paths.policyFile
                  }
                }
              }
            },
            null,
            2
          )
        );

        console.log(`\n  ⚠ Hermes/OpenClaw MCP installer will be available in Phase 3.`);
        console.log(`  For now, add the MCP config block manually or wait for installer.\n`);

        console.log(`Next steps:`);
        console.log(`  1. Run: arclayer-runner doctor`);
        console.log(`  2. Set Circle wallet policy: circle wallet limit set ...`);
        console.log(`  3. Run: arclayer-runner mcp (STDIO) or arclayer-runner start (HTTP)`);
      } catch (error: any) {
        rl.close();
        console.error(`❌ ${error.message}`);
        process.exit(1);
      }
    });
}
