/**
 * @arclayer/setup — One-command ArcLayer Runner setup.
 *
 * Thin bootstrap wrapper: delegates to `@arclayer/runner setup`.
 *
 * Usage:
 *   npx @arclayer/setup
 *   npx @arclayer/setup --target openclaw --force
 *
 * What it does:
 *   1. Runs the ArcLayer Runner interactive setup wizard
 *   2. Creates ~/.arclayer/runner/config.json and policy.json
 *   3. Configures Runner as MCP STDIO sidecar for Hermes/OpenClaw
 *
 * What it does NOT do:
 *   - Configure Telegram/Discord (that's Hermes/OpenClaw's job)
 *   - Run circle wallet login
 *   - Run circle wallet limit set
 *   - Ask for OTP or store private keys
 */

import { spawn } from "node:child_process";

export function runSetup(argv = process.argv.slice(2)) {
  const child = spawn("npx", ["-y", "@arclayer/runner", "setup", ...argv], {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error("Failed to start ArcLayer Runner setup:", error);
    process.exit(1);
  });

  return child;
}

// Only run when executed directly (not imported)
const isDirectExecution =
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectExecution) {
  runSetup();
}
