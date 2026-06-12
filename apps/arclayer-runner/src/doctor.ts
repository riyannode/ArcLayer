import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import {
  resolveRunnerPaths,
  InitFileConfigSchema,
  PolicyConfigSchema,
  transformFileConfig,
  validateWalletAddress,
  type RunnerConfig
} from "@arclayer/runner-core";

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
 */
function parseCirclePolicyLimit(output: unknown): Record<string, string> | undefined {
  if (!output || typeof output !== "object") return undefined;
  const obj = output as Record<string, unknown>;
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

/**
 * Chains where Circle wallet policy/budget checks are not supported.
 */
const UNSUPPORTED_POLICY_CHAINS = new Set([
  "ARC-TESTNET",
  "ARC",
  "LOCAL"
]);

/**
 * Run all doctor checks: local file mode + Circle CLI + runtime.
 */
export async function runDoctor(config: RunnerConfig): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // ══════════════════════════════════════════════════════════════════════
  // LOCAL FILE CHECKS
  // ══════════════════════════════════════════════════════════════════════

  const paths = resolveRunnerPaths();

  // 1. config.json exists
  const configExists = existsSync(paths.configFile);
  results.push({
    name: "config.json exists",
    ok: configExists,
    message: configExists ? `Found: ${paths.configFile}` : `Not found: ${paths.configFile}`
  });

  // 2. policy.json exists
  const policyExists = existsSync(paths.policyFile);
  results.push({
    name: "policy.json exists",
    ok: policyExists,
    message: policyExists ? `Found: ${paths.policyFile}` : `Not found: ${paths.policyFile}`
  });

  // 3. receipts.jsonl exists
  const receiptsExists = existsSync(paths.receiptsFile);
  results.push({
    name: "receipts.jsonl exists",
    ok: receiptsExists,
    message: receiptsExists ? `Found: ${paths.receiptsFile}` : `Not found: ${paths.receiptsFile} (will be created on first receipt)`
  });

  // 4. ledger.jsonl exists
  const ledgerExists = existsSync(paths.ledgerFile);
  results.push({
    name: "ledger.jsonl exists",
    ok: ledgerExists,
    message: ledgerExists ? `Found: ${paths.ledgerFile}` : `Not found: ${paths.ledgerFile} (will be created on first payment)`
  });

  // 5. config.json parses
  let parsedConfig: unknown;
  if (configExists) {
    try {
      const raw = readFileSync(paths.configFile, "utf8");
      parsedConfig = JSON.parse(raw);
      results.push({
        name: "config.json parses",
        ok: true,
        message: "Valid JSON"
      });
    } catch (error: any) {
      results.push({
        name: "config.json parses",
        ok: false,
        message: `Parse error: ${error.message}`
      });
    }
  } else {
    results.push({
      name: "config.json parses",
      ok: false,
      message: "Skipped: file not found"
    });
  }

  // 6. policy.json parses
  let parsedPolicy: unknown;
  if (policyExists) {
    try {
      const raw = readFileSync(paths.policyFile, "utf8");
      parsedPolicy = JSON.parse(raw);
      results.push({
        name: "policy.json parses",
        ok: true,
        message: "Valid JSON"
      });
    } catch (error: any) {
      results.push({
        name: "policy.json parses",
        ok: false,
        message: `Parse error: ${error.message}`
      });
    }
  } else {
    results.push({
      name: "policy.json parses",
      ok: false,
      message: "Skipped: file not found"
    });
  }

  // 7. Merged config validates (RunnerConfigSchema)
  // This is implicitly checked by the fact that loadRunnerConfig succeeded.
  // But let's explicitly validate the nested file config shape.
  if (parsedConfig && typeof parsedConfig === "object") {
    try {
      const obj = parsedConfig as Record<string, unknown>;
      if (obj.agentId && (obj.circle || obj.runtime)) {
        // Nested shape
        InitFileConfigSchema.parse(obj);
        results.push({
          name: "config.json schema valid",
          ok: true,
          message: "Nested config shape validated"
        });
      } else {
        // Flat shape — already validated by RunnerConfigSchema at load
        results.push({
          name: "config.json schema valid",
          ok: true,
          message: "Flat config shape validated"
        });
      }
    } catch (error: any) {
      results.push({
        name: "config.json schema valid",
        ok: false,
        message: `Schema error: ${error.message}`
      });
    }
  }

  // 8. Policy validates
  if (parsedPolicy && typeof parsedPolicy === "object") {
    try {
      PolicyConfigSchema.parse(parsedPolicy);
      results.push({
        name: "policy.json schema valid",
        ok: true,
        message: "Policy config validated"
      });
    } catch (error: any) {
      results.push({
        name: "policy.json schema valid",
        ok: false,
        message: `Schema error: ${error.message}`
      });
    }
  }

  // 9. Wallet address check
  if (config.circleWalletAddress) {
    const check = validateWalletAddress(config.circleWalletAddress);
    results.push({
      name: "Wallet address valid",
      ok: check.valid,
      message: check.valid
        ? `Valid: ${config.circleWalletAddress}`
        : `Invalid: ${check.error}`
    });
  } else {
    results.push({
      name: "Wallet address configured",
      ok: false,
      message: "CIRCLE_WALLET_ADDRESS not set (required for payments)"
    });
  }

  // 10. Role is valid
  const validRoles = ["provider", "client", "evaluator", "x402-agent", "identity-agent", "validation-agent", "devops-admin", "full-stack-agent"];
  const roleValid = validRoles.includes(config.defaultRole);
  results.push({
    name: "Role valid",
    ok: roleValid,
    message: roleValid ? `Role: ${config.defaultRole}` : `Invalid role: ${config.defaultRole}. Expected: ${validRoles.join(", ")}`
  });

  // 11. Target runtime is valid
  const validRuntimes = ["hermes", "openclaw", "custom"];
  const runtimeValid = validRuntimes.includes(config.runtimeKind);
  results.push({
    name: "Runtime target valid",
    ok: runtimeValid,
    message: runtimeValid ? `Runtime: ${config.runtimeKind}` : `Invalid runtime: ${config.runtimeKind}. Expected: ${validRuntimes.join(", ")}`
  });

  // 12. Local spending policy validates
  try {
    const perTx = parseFloat(config.perTxLimitUsdc);
    const daily = parseFloat(config.dailyLimitUsdc);
    const monthly = parseFloat(config.monthlyLimitUsdc);
    const batchTotal = parseFloat(config.batchMaxTotalUsdc);

    const policyIssues: string[] = [];
    if (isNaN(perTx) || perTx <= 0) policyIssues.push("perTxLimitUsdc must be > 0");
    if (isNaN(daily) || daily <= 0) policyIssues.push("dailyLimitUsdc must be > 0");
    if (isNaN(monthly) || monthly <= 0) policyIssues.push("monthlyLimitUsdc must be > 0");
    if (isNaN(batchTotal) || batchTotal <= 0) policyIssues.push("batchMaxTotalUsdc must be > 0");
    if (perTx > daily) policyIssues.push("perTxLimitUsdc exceeds dailyLimitUsdc");
    if (daily > monthly) policyIssues.push("dailyLimitUsdc exceeds monthlyLimitUsdc");

    results.push({
      name: "Local spending policy",
      ok: policyIssues.length === 0,
      message: policyIssues.length === 0
        ? `perTx=${config.perTxLimitUsdc}, daily=${config.dailyLimitUsdc}, monthly=${config.monthlyLimitUsdc}, batchMax=${config.batchMaxItems}`
        : policyIssues.join("; ")
    });
  } catch {
    results.push({
      name: "Local spending policy",
      ok: false,
      message: "Could not parse spending limits"
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // DEPRECATED FIELD CHECKS
  // ══════════════════════════════════════════════════════════════════════

  // 13. Deprecated contract address fields
  if (config.erc8183ContractAddress || config.erc8004IdentityRegistryAddress) {
    results.push({
      name: "Deprecated contract fields",
      ok: false,
      message: "erc8183ContractAddress/erc8004IdentityRegistryAddress are deprecated. Arc contract targets come from SDK constants (CONTRACTS.*). Remove these fields from config.json — they are ignored."
    });
  } else {
    results.push({
      name: "Deprecated contract fields",
      ok: true,
      message: "No deprecated contract fields found"
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // CIRCLE CLI CHECKS (advisory — warn but don't crash)
  // ══════════════════════════════════════════════════════════════════════

  // 14. Circle CLI binary exists
  const binCheck = await tryExec("which", [config.circleCliBin]);
  results.push({
    name: "Circle CLI binary",
    ok: binCheck.ok,
    message: binCheck.ok
      ? `Found: ${binCheck.stdout.trim()}`
      : `Binary '${config.circleCliBin}' not found in PATH (install Circle CLI for payments)`
  });

  // 14. circle --version works
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

  // 15. Circle wallet status
  if (binCheck.ok) {
    const statusCheck = await tryExec(config.circleCliBin, ["wallet", "status", "--type", "agent", "--output", "json"]);
    results.push({
      name: "Circle wallet status",
      ok: statusCheck.ok,
      message: statusCheck.ok
        ? "Agent wallet accessible"
        : `Failed: ${statusCheck.stderr.trim().slice(0, 200)} (run: circle wallet login)`
    });
  } else {
    results.push({
      name: "Circle wallet status",
      ok: false,
      message: "Skipped: binary not found"
    });
  }

  // 16. Circle wallet policy/budget (skip for unsupported chains)
  const skipPolicyCheck = UNSUPPORTED_POLICY_CHAINS.has(config.chain?.toUpperCase());

  if (skipPolicyCheck) {
    results.push({
      name: "Circle wallet policy",
      ok: true,
      message: `Skipped: chain '${config.chain}' does not support wallet policy checks`
    });
    results.push({
      name: "Circle wallet budget",
      ok: true,
      message: `Skipped: chain '${config.chain}' does not support budget checks`
    });
  } else if (binCheck.ok && config.circleWalletAddress) {
    // Policy check
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

    // Budget check
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
        message: "Circle wallet budget (rolling-window) retrieved",
        details: parsed
      });
    } else {
      results.push({
        name: "Circle wallet budget",
        ok: false,
        message: `Failed: ${budgetCheck.stderr.trim().slice(0, 200)}`
      });
    }

    // Policy comparison (Runner vs Circle)
    if (policyCheck.ok) {
      const circlePolicy = parseCirclePolicyLimit(tryParseJson(policyCheck.stdout));
      const warnings = comparePolicies(config, circlePolicy);
      results.push({
        name: "Policy comparison (Runner vs Circle)",
        ok: warnings.length === 0,
        message: warnings.length === 0
          ? "Runner policy is within Circle wallet policy limits"
          : warnings.join("; "),
        details: { runnerPolicy: config, circlePolicy, warnings }
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

  // ══════════════════════════════════════════════════════════════════════
  // RUNTIME CHECKS
  // ══════════════════════════════════════════════════════════════════════

  // 17. Global Skill found
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

  // 18. Runtime endpoint reachable
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

  // 19. Runner secret configured
  results.push({
    name: "Runner secret",
    ok: config.runnerSecret.length >= 16,
    message: config.runnerSecret.length >= 16
      ? "Configured (16+ chars)"
      : "Missing or too short (<16 chars)"
  });

  // 20. Payment config
  results.push({
    name: "Payment enabled",
    ok: true,
    message: config.paymentEnabled ? "Enabled" : "Disabled (set ARCLAYER_PAYMENT_ENABLED=true to enable)"
  });

  return results;
}

/**
 * Get Circle wallet policy + budget status for MCP tool.
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

  // Skip for unsupported chains
  if (UNSUPPORTED_POLICY_CHAINS.has(config.chain?.toUpperCase())) {
    warnings.push(`Chain '${config.chain}' does not support wallet policy checks`);
    return { ok: true, walletAddress: config.circleWalletAddress, chain: config.chain, runnerPolicy, warnings };
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

  // wallet limit budget
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
