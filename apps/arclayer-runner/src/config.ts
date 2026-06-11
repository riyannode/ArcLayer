import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { RunnerConfigSchema, type RunnerConfig } from "@arclayer/runner-core";

function splitCsv(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function loadRunnerConfig(): RunnerConfig {
  const envFile = process.env.ARCLAYER_RUNNER_CONFIG;
  let fileConfig: Record<string, unknown> = {};

  if (envFile && existsSync(envFile)) {
    fileConfig = JSON.parse(readFileSync(envFile, "utf8"));
  }

  const envConfig = {
    runnerId: process.env.ARCLAYER_RUNNER_ID,
    agentId: process.env.ARCLAYER_AGENT_ID,
    agentAddress: process.env.ARCLAYER_AGENT_ADDRESS,
    runtimeKind: process.env.ARCLAYER_RUNTIME_KIND,
    runtimeEndpoint: process.env.ARCLAYER_RUNTIME_ENDPOINT,
    runtimeRunPath: process.env.ARCLAYER_RUNTIME_RUN_PATH,
    defaultRole: process.env.ARCLAYER_DEFAULT_ROLE ?? "provider",
    allowedRoles: splitCsv(process.env.ARCLAYER_ALLOWED_ROLES || "provider"),
    skillPath: process.env.ARCLAYER_GLOBAL_SKILL_PATH,
    skillHash: process.env.ARCLAYER_GLOBAL_SKILL_HASH,

    chain: process.env.CIRCLE_CHAIN ?? "ARC-TESTNET",
    circleCliBin: process.env.CIRCLE_CLI_BIN ?? "circle",
    circleWalletAddress: process.env.CIRCLE_WALLET_ADDRESS,

    paymentEnabled: process.env.ARCLAYER_PAYMENT_ENABLED ?? "false",
    perTxLimitUsdc: process.env.ARCLAYER_PER_TX_LIMIT_USDC ?? "0.01",
    dailyLimitUsdc: process.env.ARCLAYER_DAILY_LIMIT_USDC ?? "1",
    monthlyLimitUsdc: process.env.ARCLAYER_MONTHLY_LIMIT_USDC ?? "20",
    batchMaxItems: process.env.ARCLAYER_BATCH_MAX_ITEMS ?? "10",
    batchMaxTotalUsdc: process.env.ARCLAYER_BATCH_MAX_TOTAL_USDC ?? "0.05",
    allowedX402Hosts: splitCsv(process.env.ARCLAYER_ALLOWED_X402_HOSTS),

    erc8183ContractAddress: process.env.ARCLAYER_ERC8183_CONTRACT,
    erc8004IdentityRegistryAddress: process.env.ARCLAYER_ERC8004_IDENTITY_REGISTRY,

    dataDir: process.env.ARCLAYER_RUNNER_DATA_DIR ?? path.resolve(process.cwd(), ".arclayer-runner"),
    port: process.env.ARCLAYER_RUNNER_PORT ?? "8787",
    runnerSecret: process.env.ARCLAYER_RUNNER_SECRET
  };

  return RunnerConfigSchema.parse({
    ...fileConfig,
    ...Object.fromEntries(Object.entries(envConfig).filter(([, v]) => v !== undefined))
  });
}
