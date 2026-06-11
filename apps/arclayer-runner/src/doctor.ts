import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import type { RunnerConfig } from "@arclayer/runner-core";

const execFileAsync = promisify(execFile);

export type CheckResult = {
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

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Parse Circle wallet limit output to extract policy caps.
 * Returns undefined if shape is unknown.
 */
function parseCirclePolicyLimit(output: unknown): Record<string, string> | undefined {
  if (!output || typeof output !== "object") return undefined;
  const obj = output as Record<string, unknown>;
  // Try common shapes
  const limits = obj.limits ?? obj.policy ?? obj;
  if (typeof limits !== "object" || !limits) return undefined;

  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(limits as Record<string, unknown>)) {
    if (typeof val === "string" || typeof val === "number") {
      result[key] = String(val);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Compare Runner policy against Circle wallet policy caps.
 * Returns warnings, not hard failures.
 */
function comparePolicies(
  config: RunnerConfig,
  circlePolicy: Record<string, string> | undefined
): string[] {
  const warnings: string[] = [];
  if (!circlePolicy) {
    warnings.push("Circle wallet policy found but could not compare automatically; inspect manually.");
    return warnings;
  }

  // Try to find per-transaction, daily, monthly keys
  const perTxKey = Object.keys(circlePolicy).find((k) =>
    /per.?tx|per.?transaction|single/i.test(k)
  );
  const dailyKey = Object.keys(circlePolicy).find((k) => /daily|day/i.test(k));
  const monthlyKey = Object.keys(circlePolicy).find((k) => /monthly|month/i.test(k));

  if (perTxKey) {
    const circleVal = parseFloat(circlePolicy[perTxKey]);
    const runnerVal = parseFloat(config.perTxLimitUsdc);
    if (!isNaN(circleVal) && runnerVal > circleVal) {
      warnings.push(
        `Runner perTxLimitUsdc (${config.perTxLimitUsdc}) exceeds Circle per-tx policy (${circlePolicy[perTxKey]})`
      );
    }
  }

  if (dailyKey) {
    const circleVal = parseFloat(circlePolicy[dailyKey]);
    const runnerVal = parseFloat(config.dailyLimitUsdc);
    if (!isNaN(circleVal) && runnerVal > circleVal) {
      warnings.push(
        `Runner dailyLimitUsdc (${config.dailyLimitUsdc}) exceeds Circle daily policy (${circlePolicy[dailyKey]})`
      );
    }
  }

  if (monthlyKey) {
    const circleVal = parseFloat(circlePolicy[monthlyKey]);
    const runnerVal = parseFloat(config.monthlyLimitUsdc);
    if (!isNaN(circleVal) && runnerVal > circleVal) {
      warnings.push(
        `Runner monthlyLimitUsdc (${config.monthlyLimitUsdc}) exceeds Circle monthly policy (${circlePolicy[monthlyKey]})`
      );
    }
  }

  if (!perTxKey && !dailyKey && !monthlyKey) {
    warnings.push("Circle wallet policy found but could not compare automatically; inspect manually.");
  }

  return warnings;
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

  // 6. Circle wallet policy (configured limits)
  if (binCheck.ok && config.circleWalletAddress) {
    const policyCheck = await tryExec(config.circleCliBin, [
      "wallet", "limit",
      "--address", config.circleWalletAddress,
      "--chain", config.chain,
      "--output", "json"
    ]);
    if (policyCheck.ok) {
      const parsed = tryParseJson(policyCheck.stdout);
      results.push({
        name: "Circle wallet policy",
        ok: true,
        message: "Circle wallet policy limits retrieved",
        details: parsed
      });
    } else {
      results.push({
        name: "Circle wallet policy",
        ok: false,
        message: `Failed: ${policyCheck.stderr.trim().slice(0, 200)}`
      });
    }
  } else {
    results.push({
      name: "Circle wallet policy",
      ok: false,
      message: !config.circleWalletAddress
        ? "Skipped: wallet address not configured"
        : "Skipped: binary not found"
    });
  }

  // 7. Circle wallet budget (remaining rolling-window budgets)
  if (binCheck.ok && config.circleWalletAddress) {
    const budgetCheck = await tryExec(config.circleCliBin, [
      "wallet", "limit", "budget",
      "--address", config.circleWalletAddress,
      "--output", "json"
    ]);
    if (budgetCheck.ok) {
      const parsed = tryParseJson(budgetCheck.stdout);
      results.push({
        name: "Circle wallet budget",
        ok: true,
        message: "Circle wallet budget (remaining rolling-window) retrieved",
        details: parsed
      });
    } else {
      results.push({
        name: "Circle wallet budget",
        ok: false,
        message: `Failed: ${budgetCheck.stderr.trim().slice(0, 200)}`
      });
    }
  } else {
    results.push({
      name: "Circle wallet budget",
      ok: false,
      message: !config.circleWalletAddress
        ? "Skipped: wallet address not configured"
        : "Skipped: binary not found"
    });
  }

  // 8. Policy comparison (Runner vs Circle)
  if (binCheck.ok && config.circleWalletAddress) {
    const policyCheck = await tryExec(config.circleCliBin, [
      "wallet", "limit",
      "--address", config.circleWalletAddress,
      "--chain", config.chain,
      "--output", "json"
    ]);

    if (policyCheck.ok) {
      const parsed = tryParseJson(policyCheck.stdout);
      const circlePolicy = parseCirclePolicyLimit(parsed);
      const warnings = comparePolicies(config, circlePolicy);

      // Check remaining budget vs Runner limits (advisory, not hard fail)
      const budgetCheck = await tryExec(config.circleCliBin, [
        "wallet", "limit", "budget",
        "--address", config.circleWalletAddress,
        "--output", "json"
      ]);

      if (budgetCheck.ok) {
        const budgetParsed = tryParseJson(budgetCheck.stdout) as Record<string, unknown> | undefined;
        if (budgetParsed && typeof budgetParsed === "object") {
          const budgets = budgetParsed.budgets ?? budgetParsed.remaining ?? budgetParsed;
          if (typeof budgets === "object" && budgets !== null) {
            for (const [key, val] of Object.entries(budgets as Record<string, unknown>)) {
              if (typeof val === "number" || typeof val === "string") {
                const numVal = parseFloat(String(val));
                if (/daily|day/i.test(key) && !isNaN(numVal)) {
                  const runnerDaily = parseFloat(config.dailyLimitUsdc);
                  if (numVal < runnerDaily) {
                    warnings.push(
                      `Circle remaining budget for "${key}" (${val}) is lower than Runner dailyLimitUsdc (${config.dailyLimitUsdc}). This is a rolling-window status, not a policy mismatch.`
                    );
                  }
                }
                if (/monthly|month/i.test(key) && !isNaN(numVal)) {
                  const runnerMonthly = parseFloat(config.monthlyLimitUsdc);
                  if (numVal < runnerMonthly) {
                    warnings.push(
                      `Circle remaining budget for "${key}" (${val}) is lower than Runner monthlyLimitUsdc (${config.monthlyLimitUsdc}). This is a rolling-window status, not a policy mismatch.`
                    );
                  }
                }
              }
            }
          }
        }
      }

      results.push({
        name: "Policy comparison (Runner vs Circle)",
        ok: warnings.length === 0,
        message: warnings.length === 0
          ? "Runner policy is within Circle wallet policy limits"
          : warnings.join("; "),
        details: { runnerPolicy: config, circlePolicy, warnings }
      });
    } else {
      results.push({
        name: "Policy comparison (Runner vs Circle)",
        ok: false,
        message: "Skipped: could not retrieve Circle wallet policy"
      });
    }
  } else {
    results.push({
      name: "Policy comparison (Runner vs Circle)",
      ok: false,
      message: !config.circleWalletAddress
        ? "Skipped: wallet address not configured"
        : "Skipped: binary not found"
    });
  }

  // 9. Global Skill found
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

  // 10. Runtime endpoint reachable
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

  // 11. Runner secret configured
  results.push({
    name: "Runner secret",
    ok: config.runnerSecret.length >= 16,
    message: config.runnerSecret.length >= 16
      ? "Configured (16+ chars)"
      : "Missing or too short (<16 chars)"
  });

  // 12. Payment config
  results.push({
    name: "Payment enabled",
    ok: true,
    message: config.paymentEnabled ? "Enabled" : "Disabled (set ARCLAYER_PAYMENT_ENABLED=true to enable)"
  });

  return results;
}

/**
 * Get Circle wallet policy + budget status for MCP tool.
 * Returns raw parsed output + warnings. Never crashes.
 */
export async function getCirclePolicyStatus(config: RunnerConfig): Promise<{
  ok: boolean;
  walletAddress?: string;
  chain?: string;
  runnerPolicy: Record<string, unknown>;
  circlePolicy?: unknown;
  circleBudget?: unknown;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const runnerPolicy = {
    perTxLimitUsdc: config.perTxLimitUsdc,
    dailyLimitUsdc: config.dailyLimitUsdc,
    monthlyLimitUsdc: config.monthlyLimitUsdc,
    batchMaxTotalUsdc: config.batchMaxTotalUsdc,
    paymentEnabled: config.paymentEnabled
  };

  if (!config.circleWalletAddress) {
    warnings.push("CIRCLE_WALLET_ADDRESS not configured");
    return { ok: false, runnerPolicy, warnings };
  }

  // wallet limit (policy caps)
  let circlePolicy: unknown;
  const policyResult = await tryExec(config.circleCliBin, [
    "wallet", "limit",
    "--address", config.circleWalletAddress,
    "--chain", config.chain,
    "--output", "json"
  ]);
  if (policyResult.ok) {
    circlePolicy = tryParseJson(policyResult.stdout);
    if (!circlePolicy) {
      warnings.push("Circle wallet policy returned non-JSON output");
    }
  } else {
    warnings.push(`Circle wallet limit failed: ${policyResult.stderr.trim().slice(0, 200)}`);
  }

  // wallet limit budget (remaining rolling-window)
  let circleBudget: unknown;
  const budgetResult = await tryExec(config.circleCliBin, [
    "wallet", "limit", "budget",
    "--address", config.circleWalletAddress,
    "--output", "json"
  ]);
  if (budgetResult.ok) {
    circleBudget = tryParseJson(budgetResult.stdout);
    if (!circleBudget) {
      warnings.push("Circle wallet budget returned non-JSON output");
    }
  } else {
    warnings.push(`Circle wallet limit budget failed: ${budgetResult.stderr.trim().slice(0, 200)}`);
  }

  // Policy comparison
  const parsed = parseCirclePolicyLimit(circlePolicy);
  const policyWarnings = comparePolicies(config, parsed);
  warnings.push(...policyWarnings);

  return {
    ok: warnings.length === 0,
    walletAddress: config.circleWalletAddress,
    chain: config.chain,
    runnerPolicy,
    circlePolicy,
    circleBudget,
    warnings
  };
}
