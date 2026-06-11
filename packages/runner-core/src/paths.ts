/**
 * Standard path resolution for ArcLayer Runner config/data directories.
 *
 * Default layout:
 *   ~/.arclayer/runner/config.json
 *   ~/.arclayer/runner/policy.json
 *   ~/.arclayer/runner/receipts.jsonl
 *   ~/.arclayer/runner/ledger.jsonl
 *
 * All paths are overridable via env vars.
 */

import { homedir } from "node:os";
import path from "node:path";

export type RunnerPaths = {
  configDir: string;
  configFile: string;
  policyFile: string;
  dataDir: string;
  receiptsFile: string;
  ledgerFile: string;
};

/**
 * Resolve the Runner config/data directory paths.
 * Priority: ARCLAYER_RUNNER_DIR env → ~/.arclayer/runner
 */
export function resolveRunnerPaths(overrides?: {
  configDir?: string;
  dataDir?: string;
}): RunnerPaths {
  const configDir =
    overrides?.configDir ??
    process.env.ARCLAYER_RUNNER_DIR ??
    path.join(homedir(), ".arclayer", "runner");

  const dataDir = overrides?.dataDir ?? configDir;

  return {
    configDir,
    configFile: path.join(configDir, "config.json"),
    policyFile: path.join(configDir, "policy.json"),
    dataDir,
    receiptsFile: path.join(dataDir, "receipts.jsonl"),
    ledgerFile: path.join(dataDir, "ledger.jsonl")
  };
}
