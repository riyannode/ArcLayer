import { existsSync, readFileSync } from "node:fs";
import {
  resolveRunnerPaths,
  InitFileConfigSchema,
  PolicyConfigSchema,
  transformFileConfig,
  validateWalletAddress,
  type RunnerConfig
} from "@arclayer/runner-core";

export type CheckResult = {
  name: string;
  ok: boolean;
  message: string;
  details?: unknown;
};

/**
 * Run all doctor checks: local file mode + wallet adapter readiness + runtime.
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
  const validRoles = ["provider", "client", "evaluator", "x402-agent"];
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
  // WALLET ADAPTER READINESS CHECKS
  // ══════════════════════════════════════════════════════════════════════

  // 14. Wallet rail
  const walletRailValid = config.walletRail === "circle-dev";
  results.push({
    name: "Wallet rail",
    ok: walletRailValid,
    message: walletRailValid
      ? `Rail: ${config.walletRail}`
      : `Unsupported wallet rail: ${config.walletRail}. Only circle-dev is supported.`
  });

  // 15. Circle Dev Wallet API key configured
  const hasApiKey = typeof config.circleApiKey === "string" && config.circleApiKey.length > 0;
  results.push({
    name: "Circle Dev Wallet API key",
    ok: hasApiKey,
    message: hasApiKey
      ? "Configured"
      : "CIRCLE_API_KEY not set (required for Circle Dev Wallet)"
  });

  // 16. Circle Dev Wallet entity secret configured
  const hasEntitySecret = typeof config.circleEntitySecret === "string" && config.circleEntitySecret.length > 0;
  results.push({
    name: "Circle Dev Wallet entity secret",
    ok: hasEntitySecret,
    message: hasEntitySecret
      ? "Configured"
      : "CIRCLE_ENTITY_SECRET not set (required for Circle Dev Wallet)"
  });

  // 17. Circle wallet ID configured
  const hasWalletId = typeof config.circleWalletId === "string" && config.circleWalletId.length > 0;
  results.push({
    name: "Circle wallet ID",
    ok: hasWalletId,
    message: hasWalletId
      ? `Configured: ${config.circleWalletId}`
      : "CIRCLE_WALLET_ID not set (required for Circle Dev Wallet)"
  });

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
