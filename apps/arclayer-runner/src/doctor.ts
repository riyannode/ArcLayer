import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import type { RunnerConfig } from "@arclayer/runner-core";

const execFileAsync = promisify(execFile);

type CheckResult = {
  name: string;
  ok: boolean;
  message: string;
  details?: unknown;
};

async function tryExec(bin: string, args: string[], timeoutMs = 10000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { timeout: timeoutMs });
    return { ok: true, stdout, stderr };
  } catch (error: any) {
    return { ok: false, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message };
  }
}

export async function runDoctor(config: RunnerConfig): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. Circle CLI binary exists
  const binCheck = await tryExec("which", [config.circleCliBin]);
  results.push({
    name: "Circle CLI binary",
    ok: binCheck.ok,
    message: binCheck.ok
      ? `Found: ${binCheck.stdout.trim()}`
      : `Binary '${config.circleCliBin}' not found in PATH`
  });

  // 2. circle --version works
  if (binCheck.ok) {
    const versionCheck = await tryExec(config.circleCliBin, ["--version"]);
    results.push({
      name: "Circle CLI version",
      ok: versionCheck.ok,
      message: versionCheck.ok
        ? versionCheck.stdout.trim().split("\n")[0]
        : `Failed: ${versionCheck.stderr.trim()}`
    });
  } else {
    results.push({
      name: "Circle CLI version",
      ok: false,
      message: "Skipped: binary not found"
    });
  }

  // 3. circle wallet status --type agent --output json
  if (binCheck.ok) {
    const statusCheck = await tryExec(config.circleCliBin, ["wallet", "status", "--type", "agent", "--output", "json"]);
    results.push({
      name: "Circle wallet status",
      ok: statusCheck.ok,
      message: statusCheck.ok
        ? "Agent wallet accessible"
        : `Failed: ${statusCheck.stderr.trim().slice(0, 200)}`
    });
  } else {
    results.push({
      name: "Circle wallet status",
      ok: false,
      message: "Skipped: binary not found"
    });
  }

  // 4. Configured wallet address exists
  results.push({
    name: "Wallet address configured",
    ok: !!config.circleWalletAddress,
    message: config.circleWalletAddress
      ? `Configured: ${config.circleWalletAddress}`
      : "CIRCLE_WALLET_ADDRESS not set"
  });

  // 5. Gateway balance (if wallet configured)
  if (binCheck.ok && config.circleWalletAddress) {
    const gwCheck = await tryExec(config.circleCliBin, [
      "gateway", "balance",
      "--address", config.circleWalletAddress,
      "--chain", config.chain,
      "--output", "json"
    ]);
    results.push({
      name: "Gateway balance",
      ok: gwCheck.ok,
      message: gwCheck.ok
        ? "Gateway balance query succeeded"
        : `Failed: ${gwCheck.stderr.trim().slice(0, 200)}`
    });
  } else {
    results.push({
      name: "Gateway balance",
      ok: false,
      message: !config.circleWalletAddress
        ? "Skipped: wallet address not configured"
        : "Skipped: binary not found"
    });
  }

  // 6. Global Skill found
  const skillPaths = [
    config.skillPath,
    "docs/ARCLAYER_GLOBAL_AGENT_SKILL.md",
    "../../docs/ARCLAYER_GLOBAL_AGENT_SKILL.md"
  ].filter(Boolean) as string[];

  const skillFound = skillPaths.some((p) => existsSync(p));
  results.push({
    name: "Global Skill",
    ok: skillFound,
    message: skillFound
      ? "ARCLAYER_GLOBAL_AGENT_SKILL.md found"
      : `Not found in: ${skillPaths.join(", ")}`
  });

  // 7. Runtime endpoint reachable
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(config.runtimeEndpoint, { signal: controller.signal });
    clearTimeout(timeout);
    results.push({
      name: "Runtime endpoint",
      ok: res.status < 500,
      message: `Reachable: ${config.runtimeEndpoint} (HTTP ${res.status})`
    });
  } catch (error: any) {
    results.push({
      name: "Runtime endpoint",
      ok: false,
      message: `Unreachable: ${config.runtimeEndpoint} — ${error.message}`
    });
  }

  // 8. Runner secret configured
  results.push({
    name: "Runner secret",
    ok: config.runnerSecret.length >= 16,
    message: config.runnerSecret.length >= 16
      ? "Configured (16+ chars)"
      : "Missing or too short (<16 chars)"
  });

  // 9. Payment config
  results.push({
    name: "Payment enabled",
    ok: true,
    message: config.paymentEnabled ? "Enabled" : "Disabled (set ARCLAYER_PAYMENT_ENABLED=true to enable)"
  });

  return results;
}
