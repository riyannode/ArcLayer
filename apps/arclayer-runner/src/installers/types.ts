/**
 * Installer interface for MCP STDIO sidecar registration.
 *
 * Each installer targets a specific LLM runtime (Hermes, OpenClaw).
 * Safe by default: backup before write, manual fallback if path unknown.
 */

export type McpServerConfig = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export type InstallTarget = "hermes" | "openclaw";

export type InstallMode = "stdio";

export type InstallResult = {
  ok: boolean;
  target: InstallTarget;
  configPath?: string;
  backupPath?: string;
  action: "installed" | "skipped" | "manual";
  message: string;
  manualConfig?: Record<string, McpServerConfig>;
};

export interface RuntimeInstaller {
  readonly target: InstallTarget;
  /**
   * Detect whether the runtime's config file exists.
   * Returns the config path if found, undefined otherwise.
   */
  detectConfigPath(): string | undefined;
  /**
   * Install the MCP server config into the runtime's config file.
   * Safe: backs up before writing, deep merges, never overwrites unknown keys.
   */
  install(mcpConfig: McpServerConfig): Promise<InstallResult>;
}
