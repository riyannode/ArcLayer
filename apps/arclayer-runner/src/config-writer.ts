/**
 * Config writer — shared by init (non-interactive) and setup (interactive).
 *
 * Writes config.json and policy.json to ~/.arclayer/runner/
 * Creates data files (receipts.jsonl, ledger.jsonl) if missing.
 * File permissions: 0700 for directory, 0600 for files.
 */

import { mkdir, writeFile, readFile, access, constants } from "node:fs/promises";
import path from "node:path";
import {
  resolveRunnerPaths,
  PolicyConfigSchema,
  InitFileConfigSchema,
  validateWalletAddress,
  type InitFileConfig,
  type PolicyConfig,
  type RunnerPaths
} from "@arclayer/runner-core";

export type WriteConfigInput = {
  agentId: string;
  role: string;
  walletAddress?: string;
  chain?: string;
  runtimeTarget?: string;
  paymentEnabled?: boolean;
  perTxLimitUsdc?: string;
  dailyLimitUsdc?: string;
  monthlyLimitUsdc?: string;
  batchMaxItems?: number;
  batchMaxTotalUsdc?: string;
  allowedX402Hosts?: string[];
  cliBin?: string;
};

export type WriteConfigResult = {
  ok: boolean;
  paths: RunnerPaths;
  config: InitFileConfig;
  policy: PolicyConfig;
  created: string[];
  skipped: string[];
  warnings: string[];
};

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write config.json and policy.json to the runner directory.
 * Creates data files if missing. Refuses to overwrite unless force=true.
 */
export async function writeRunnerConfig(
  input: WriteConfigInput,
  options: { force?: boolean } = {}
): Promise<WriteConfigResult> {
  const paths = resolveRunnerPaths();
  const created: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  // ── Validate wallet address ───────────────────────────────────────────
  if (input.walletAddress) {
    const check = validateWalletAddress(input.walletAddress);
    if (!check.valid) {
      throw new Error(`Wallet validation failed: ${check.error}`);
    }
  }

  // ── Build config object ──────────────────────────────────────────────
  const config: InitFileConfig = {
    agentId: input.agentId,
    role: (input.role as any) ?? "provider",
    circle: {
      cliBin: input.cliBin ?? "circle",
      walletAddress: input.walletAddress ?? undefined,
      chain: input.chain ?? "BASE"
    },
    runtime: {
      target: (input.runtimeTarget as any) ?? "openclaw"
    },
    mcp: {
      mode: "stdio"
    }
  };

  // Validate against schema
  const validatedConfig = InitFileConfigSchema.parse(config);

  // ── Build policy object ──────────────────────────────────────────────
  const policy: PolicyConfig = PolicyConfigSchema.parse({
    paymentEnabled: input.paymentEnabled ?? false,
    perTxLimitUsdc: input.perTxLimitUsdc ?? "0.01",
    dailyLimitUsdc: input.dailyLimitUsdc ?? "1",
    monthlyLimitUsdc: input.monthlyLimitUsdc ?? "20",
    batchMaxItems: input.batchMaxItems ?? 10,
    batchMaxTotalUsdc: input.batchMaxTotalUsdc ?? "0.05",
    allowedX402Hosts: input.allowedX402Hosts ?? []
  });

  // ── Create directory (0700) ──────────────────────────────────────────
  await mkdir(paths.configDir, { recursive: true, mode: 0o700 });

  // ── Check existing files ─────────────────────────────────────────────
  const configExists = await fileExists(paths.configFile);
  const policyExists = await fileExists(paths.policyFile);

  if (configExists && !options.force) {
    throw new Error(
      `config.json already exists at ${paths.configFile}. Use --force to overwrite.`
    );
  }
  if (policyExists && !options.force) {
    throw new Error(
      `policy.json already exists at ${paths.policyFile}. Use --force to overwrite.`
    );
  }

  // ── Write config.json (0600) ─────────────────────────────────────────
  await writeFile(
    paths.configFile,
    JSON.stringify(validatedConfig, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 }
  );
  created.push(paths.configFile);

  // ── Write policy.json (0600) ─────────────────────────────────────────
  await writeFile(
    paths.policyFile,
    JSON.stringify(policy, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 }
  );
  created.push(paths.policyFile);

  // ── Touch data files (0600) ──────────────────────────────────────────
  for (const dataFile of [paths.receiptsFile, paths.ledgerFile]) {
    const exists = await fileExists(dataFile);
    if (!exists) {
      await writeFile(dataFile, "", { encoding: "utf8", mode: 0o600 });
      created.push(dataFile);
    } else {
      skipped.push(dataFile);
    }
  }

  return {
    ok: true,
    paths,
    config: validatedConfig,
    policy,
    created,
    skipped,
    warnings
  };
}
