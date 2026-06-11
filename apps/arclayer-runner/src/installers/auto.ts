/**
 * Auto-detect installed LLM runtimes and build MCP config.
 *
 * Returns list of detected runtimes and the standard MCP config block
 * for arclayer-runner STDIO sidecar.
 */

import { resolveRunnerPaths } from "@arclayer/runner-core";
import { HermesInstaller } from "./hermes";
import { OpenClawInstaller } from "./openclaw";
import type { InstallTarget, McpServerConfig, RuntimeInstaller } from "./types";

export type DetectedRuntime = {
  target: InstallTarget;
  installer: RuntimeInstaller;
  configPath: string | undefined;
  installed: boolean;
};

/**
 * Build the standard MCP server config block for arclayer-runner.
 */
export function buildMcpServerConfig(): McpServerConfig {
  const paths = resolveRunnerPaths();
  return {
    command: "npx",
    args: ["-y", "@arclayer/runner", "mcp"],
    env: {
      ARCLAYER_RUNNER_CONFIG: paths.configFile,
      ARCLAYER_RUNNER_POLICY: paths.policyFile
    }
  };
}

/**
 * Detect all known runtimes and return their status.
 */
export function detectAllRuntimes(): DetectedRuntime[] {
  const installers: RuntimeInstaller[] = [
    new HermesInstaller(),
    new OpenClawInstaller()
  ];

  return installers.map((installer) => {
    const configPath = installer.detectConfigPath();
    return {
      target: installer.target,
      installer,
      configPath,
      installed: !!configPath
    };
  });
}

/**
 * Get installer for a specific target.
 */
export function getInstaller(target: InstallTarget): RuntimeInstaller {
  switch (target) {
    case "hermes":
      return new HermesInstaller();
    case "openclaw":
      return new OpenClawInstaller();
    default:
      throw new Error(`Unknown install target: ${target}`);
  }
}

/**
 * Format the manual MCP config block for printing.
 */
export function formatManualMcpConfig(mcpConfig: McpServerConfig): string {
  return JSON.stringify(
    {
      mcpServers: {
        "arclayer-runner": mcpConfig
      }
    },
    null,
    2
  );
}
