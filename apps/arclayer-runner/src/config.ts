import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  RunnerConfigSchema,
  PolicyConfigSchema,
  InitFileConfigSchema,
  transformFileConfig,
  resolveRunnerPaths,
  type RunnerConfig
} from "@arclayer/runner-core";

function splitCsv(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Load .env file from standard locations.
 * Does NOT override existing process.env values.
 */
function loadDotEnv(): void {
  const candidates = [
    process.env.ARCLAYER_RUNNER_CONFIG,
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "apps/arclayer-runner/.env")
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const content = readFileSync(candidate, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!(key in process.env)) {
          process.env[key] = val;
        }
      }
      break; // load first found only
    }
  }
}

/**
 * Try to parse a JSON file. Returns undefined if missing or invalid.
 */
function tryReadJson(filePath: string): Record<string, unknown> | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Detect whether a parsed JSON object is the nested InitFileConfig shape
 * or the legacy flat config shape.
 */
function isNestedFileConfig(obj: Record<string, unknown>): boolean {
  return typeof obj.agentId === "string" && (obj.circle !== undefined || obj.runtime !== undefined);
}

/**
 * Build flat config from file data + env vars.
 * Handles both nested (new) and flat (legacy) config.json shapes.
 */
function buildFlatConfig(
  fileConfig: Record<string, unknown>,
  policyFile: Record<string, unknown> | undefined,
  envConfig: Record<string, unknown>
): Record<string, unknown> {
  let merged: Record<string, unknown> = {};

  // ── Detect file config shape ───────────────────────────────────────
  if (isNestedFileConfig(fileConfig)) {
    // New nested shape: transform to flat
    try {
      const nested = InitFileConfigSchema.parse(fileConfig);
      let policy = PolicyConfigSchema.parse({});
      if (policyFile) {
        try {
          policy = PolicyConfigSchema.parse(policyFile);
        } catch {
          // invalid policy.json — use defaults
        }
      }
      merged = transformFileConfig(nested, policy);
    } catch {
      // Invalid nested config — fall through with empty merged
    }
  } else {
    // Legacy flat shape: use directly
    merged = { ...fileConfig };
    // Also merge policy.json if present
    if (policyFile) {
      try {
        const validatedPolicy = PolicyConfigSchema.parse(policyFile);
        merged = { ...merged, ...validatedPolicy };
      } catch {
        // skip
      }
    }
  }

  return { ...merged, ...envConfig };
}

export function loadRunnerConfig(): RunnerConfig {
  // Load .env if not already loaded
  if (!process.env._ARCLAYER_RUNNER_ENV_LOADED) {
    loadDotEnv();
    process.env._ARCLAYER_RUNNER_ENV_LOADED = "1";
  }

  // ── 1. Explicit config file (ARCLAYER_RUNNER_CONFIG env) ───────────────
  const envFile = process.env.ARCLAYER_RUNNER_CONFIG;
  let fileConfig: Record<string, unknown> = {};

  if (envFile && existsSync(envFile)) {
    fileConfig = JSON.parse(readFileSync(envFile, "utf8"));
  }

  // ── 2. Standard path resolution (~/.arclayer/runner/) ──────────────────
  const paths = resolveRunnerPaths();

  if (!envFile) {
    const standardConfig = tryReadJson(paths.configFile);
    if (standardConfig) {
      fileConfig = { ...standardConfig, ...fileConfig };
    }
  }

  // Load policy.json
  const policyFile = tryReadJson(paths.policyFile);

  // ── 3. Env vars (only actually-set values, not defaults) ──────────────
  const envConfig = buildEnvConfig();

  // ── 4. Merge: file → policy → env ─────────────────────────────────────
  const flat = buildFlatConfig(fileConfig, policyFile, envConfig);
  return RunnerConfigSchema.parse(flat);
}

/**
 * Load config for STDIO mode — same logic but runnerSecret is optional.
 */
export function loadRunnerConfigForStdio(): RunnerConfig {
  if (!process.env._ARCLAYER_RUNNER_ENV_LOADED) {
    loadDotEnv();
    process.env._ARCLAYER_RUNNER_ENV_LOADED = "1";
  }

  const envFile = process.env.ARCLAYER_RUNNER_CONFIG;
  let fileConfig: Record<string, unknown> = {};

  if (envFile && existsSync(envFile)) {
    fileConfig = JSON.parse(readFileSync(envFile, "utf8"));
  }

  const paths = resolveRunnerPaths();

  if (!envFile) {
    const standardConfig = tryReadJson(paths.configFile);
    if (standardConfig) {
      fileConfig = { ...standardConfig, ...fileConfig };
    }
  }

  const policyFile = tryReadJson(paths.policyFile);
  const envConfig = buildEnvConfig();

  // STDIO: runnerSecret not required
  if (!process.env.ARCLAYER_RUNNER_SECRET) {
    envConfig.runnerSecret = "stdio-local-process-isolation-no-http";
  }

  const flat = buildFlatConfig(fileConfig, policyFile, envConfig);
  return RunnerConfigSchema.parse(flat);
}

/**
 * Extract env vars into a flat config object.
 * Only includes values that are actually set.
 */
function buildEnvConfig(): Record<string, unknown> {
  const envConfig: Record<string, unknown> = {};

  const set = (key: string, val: unknown) => {
    if (val !== undefined) envConfig[key] = val;
  };

  set("runnerId", process.env.ARCLAYER_RUNNER_ID);
  set("agentId", process.env.ARCLAYER_AGENT_ID);
  set("agentAddress", process.env.ARCLAYER_AGENT_ADDRESS);
  set("runtimeKind", process.env.ARCLAYER_RUNTIME_KIND);
  set("runtimeEndpoint", process.env.ARCLAYER_RUNTIME_ENDPOINT);
  set("runtimeRunPath", process.env.ARCLAYER_RUNTIME_RUN_PATH);
  if (process.env.ARCLAYER_DEFAULT_ROLE) set("defaultRole", process.env.ARCLAYER_DEFAULT_ROLE);
  if (process.env.ARCLAYER_ALLOWED_ROLES) set("allowedRoles", splitCsv(process.env.ARCLAYER_ALLOWED_ROLES));
  set("skillPath", process.env.ARCLAYER_GLOBAL_SKILL_PATH);
  set("skillHash", process.env.ARCLAYER_GLOBAL_SKILL_HASH);

  if (process.env.CIRCLE_CHAIN) set("chain", process.env.CIRCLE_CHAIN);
  if (process.env.CIRCLE_CLI_BIN) set("circleCliBin", process.env.CIRCLE_CLI_BIN);
  set("circleWalletAddress", process.env.CIRCLE_WALLET_ADDRESS);

  if (process.env.ARCLAYER_PAYMENT_ENABLED) set("paymentEnabled", process.env.ARCLAYER_PAYMENT_ENABLED);
  if (process.env.ARCLAYER_PER_TX_LIMIT_USDC) set("perTxLimitUsdc", process.env.ARCLAYER_PER_TX_LIMIT_USDC);
  if (process.env.ARCLAYER_DAILY_LIMIT_USDC) set("dailyLimitUsdc", process.env.ARCLAYER_DAILY_LIMIT_USDC);
  if (process.env.ARCLAYER_MONTHLY_LIMIT_USDC) set("monthlyLimitUsdc", process.env.ARCLAYER_MONTHLY_LIMIT_USDC);
  if (process.env.ARCLAYER_BATCH_MAX_ITEMS) set("batchMaxItems", process.env.ARCLAYER_BATCH_MAX_ITEMS);
  if (process.env.ARCLAYER_BATCH_MAX_TOTAL_USDC) set("batchMaxTotalUsdc", process.env.ARCLAYER_BATCH_MAX_TOTAL_USDC);
  if (process.env.ARCLAYER_ALLOWED_X402_HOSTS) set("allowedX402Hosts", splitCsv(process.env.ARCLAYER_ALLOWED_X402_HOSTS));

  set("erc8183ContractAddress", process.env.ARCLAYER_ERC8183_CONTRACT);
  set("erc8004IdentityRegistryAddress", process.env.ARCLAYER_ERC8004_IDENTITY_REGISTRY);

  if (process.env.ARCLAYER_RUNNER_DATA_DIR) set("dataDir", process.env.ARCLAYER_RUNNER_DATA_DIR);
  if (process.env.ARCLAYER_RUNNER_PORT) set("port", process.env.ARCLAYER_RUNNER_PORT);
  set("runnerSecret", process.env.ARCLAYER_RUNNER_SECRET);

  return envConfig;
}
