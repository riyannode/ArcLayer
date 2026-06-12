/**
 * Hermes MCP installer.
 *
 * Detects ~/.hermes/config.yaml, injects arclayer-runner MCP STDIO sidecar.
 * Safe: backs up before write, deep merges mcpServers, never overwrites other keys.
 *
 * Hermes config is YAML with an mcpServers section:
 *   mcpServers:
 *     server-name:
 *       command: npx
 *       args: [...]
 *       env: {...}
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { RuntimeInstaller, McpServerConfig, InstallResult } from "./types";

const HERMES_CONFIG_CANDIDATES = [
  path.join(homedir(), ".hermes", "config.yaml"),
  path.join(homedir(), ".hermes", "config.yml")
];

export class HermesInstaller implements RuntimeInstaller {
  readonly target = "hermes" as const;

  private configPath: string | undefined;

  detectConfigPath(): string | undefined {
    if (this.configPath !== undefined) return this.configPath;

    for (const candidate of HERMES_CONFIG_CANDIDATES) {
      if (existsSync(candidate)) {
        this.configPath = candidate;
        return candidate;
      }
    }
    return undefined;
  }

  async install(mcpConfig: McpServerConfig): Promise<InstallResult> {
    const configPath = this.detectConfigPath();

    if (!configPath) {
      return {
        ok: true,
        target: "hermes",
        action: "manual",
        message: "Hermes config not found. Add the MCP config block manually.",
        manualConfig: { "arclayer-runner": mcpConfig }
      };
    }

    // Read existing config
    let existingRaw: string;
    try {
      existingRaw = readFileSync(configPath, "utf8");
    } catch (error: any) {
      return {
        ok: false,
        target: "hermes",
        configPath,
        action: "skipped",
        message: `Cannot read Hermes config: ${error.message}`
      };
    }

    // Parse YAML
    let existing: Record<string, unknown>;
    try {
      existing = yamlParse(existingRaw) ?? {};
    } catch (error: any) {
      return {
        ok: false,
        target: "hermes",
        configPath,
        action: "skipped",
        message: `Cannot parse Hermes config YAML: ${error.message}`
      };
    }

    if (typeof existing !== "object" || existing === null) {
      existing = {};
    }

    // Deep merge: only add/update mcpServers.arclayer-runner
    const mcpServers = (existing.mcpServers as Record<string, unknown>) ?? {};
    mcpServers["arclayer-runner"] = mcpConfig;
    existing.mcpServers = mcpServers;

    // Backup before writing
    const backupPath = `${configPath}.bak`;
    try {
      copyFileSync(configPath, backupPath);
    } catch (error: any) {
      return {
        ok: false,
        target: "hermes",
        configPath,
        action: "skipped",
        message: `Cannot backup Hermes config: ${error.message}`
      };
    }

    // Write updated config
    try {
      writeFileSync(configPath, yamlStringify(existing, { indent: 2 }), {
        encoding: "utf8",
        mode: 0o600
      });
    } catch (error: any) {
      return {
        ok: false,
        target: "hermes",
        configPath,
        backupPath,
        action: "skipped",
        message: `Cannot write Hermes config: ${error.message}`
      };
    }

    return {
      ok: true,
      target: "hermes",
      configPath,
      backupPath,
      action: "installed",
      message: `MCP server 'arclayer-runner' installed into ${configPath}. Backup: ${backupPath}`
    };
  }
}
