import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { RunnerConfigSchema, type RunnerConfig } from "@arclayer/runner-core";

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

export function loadRunnerConfig(): RunnerConfig {
  // Load .env if not already loaded
  if (!process.env._ARCLAYER_RUNNER_ENV_LOADED) {
    loadDotEnv();
    process.env._ARCLAYER_RUNNER_ENV_LOADED = "1";
  }

  const envFile = process.env.ARCLAYER_RUNNER_CONFIG;
  let fileConfig: Record<string, unknown> = {};

  if (envFile && existsSync(envFile)) {
    fileConfig = JSON.parse(readFileSync(envFile, "utf8"));
  }

  // Only include env vars that are actually set (not defaults).
  // This prevents env defaults from overwriting file config values.
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

  // Merge: file config first, then only actually-set env vars override
  return RunnerConfigSchema.parse({
    ...fileConfig,
    ...envConfig
  });
}
