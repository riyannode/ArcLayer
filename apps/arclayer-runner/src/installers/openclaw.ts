/**
 * OpenClaw MCP installer.
 *
 * Detects OpenClaw config (JSON), injects arclayer-runner MCP STDIO sidecar.
 * Safe: backs up before write, deep merges mcpServers, never overwrites other keys.
 *
 * OpenClaw config is JSON with an mcpServers section:
 *   { "mcpServers": { "server-name": { "command": "...", "args": [...] } } }
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { RuntimeInstaller, McpServerConfig, InstallResult } from "./types";

const OPENCLAW_CONFIG_CANDIDATES = [
  path.join(homedir(), ".openclaw", "config.json"),
  path.join(homedir(), ".config", "openclaw", "config.json"),
  path.join(homedir(), ".openclaw", "mcp.json")
];

export class OpenClawInstaller implements RuntimeInstaller {
  readonly target = "openclaw" as const;

  private configPath: string | undefined;

  detectConfigPath(): string | undefined {
    if (this.configPath !== undefined) return this.configPath;

    for (const candidate of OPENCLAW_CONFIG_CANDIDATES) {
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
        target: "openclaw",
        action: "manual",
        message: "OpenClaw config not found. Add the MCP config block manually.",
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
        target: "openclaw",
        configPath,
        action: "skipped",
        message: `Cannot read OpenClaw config: ${error.message}`
      };
    }

    // Parse JSON
    let existing: Record<string, unknown>;
    try {
      existing = JSON.parse(existingRaw);
    } catch (error: any) {
      return {
        ok: false,
        target: "openclaw",
        configPath,
        action: "skipped",
        message: `Cannot parse OpenClaw config JSON: ${error.message}`
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
        target: "openclaw",
        configPath,
        action: "skipped",
        message: `Cannot backup OpenClaw config: ${error.message}`
      };
    }

    // Write updated config
    try {
      writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n", {
        encoding: "utf8",
        mode: 0o600
      });
    } catch (error: any) {
      return {
        ok: false,
        target: "openclaw",
        configPath,
        backupPath,
        action: "skipped",
        message: `Cannot write OpenClaw config: ${error.message}`
      };
    }

    return {
      ok: true,
      target: "openclaw",
      configPath,
      backupPath,
      action: "installed",
      message: `MCP server 'arclayer-runner' installed into ${configPath}. Backup: ${backupPath}`
    };
  }
}
