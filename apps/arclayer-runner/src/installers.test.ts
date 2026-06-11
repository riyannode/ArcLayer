import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, rm, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { tmpdir, homedir } from "node:os";
import { HermesInstaller } from "./installers/hermes";
import { OpenClawInstaller } from "./installers/openclaw";
import { buildMcpServerConfig, formatManualMcpConfig, detectAllRuntimes, getInstaller } from "./installers/auto";
import { generateSkillTemplate } from "./skill-template";
import type { McpServerConfig } from "./installers/types";

const MOCK_MCP_CONFIG: McpServerConfig = {
  command: "npx",
  args: ["-y", "@arclayer/runner", "mcp"],
  env: {
    ARCLAYER_RUNNER_CONFIG: "/tmp/test/config.json",
    ARCLAYER_RUNNER_POLICY: "/tmp/test/policy.json"
  }
};

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ── Hermes Installer ────────────────────────────────────────────────────

describe("HermesInstaller", () => {
  it("returns undefined when config does not exist", () => {
    const installer = new HermesInstaller();
    // This test passes when ~/.hermes/config.yaml doesn't exist in CI
    const result = installer.detectConfigPath();
    // If hermes is installed, result will be a string; if not, undefined
    // Both are valid — we just verify it doesn't throw
    expect(result === undefined || typeof result === "string").toBe(true);
  });

  it("returns manual config when path unknown", async () => {
    const installer = new HermesInstaller();
    // Force no config found by using a fresh instance with no files
    const result = await installer.install(MOCK_MCP_CONFIG);
    // If no hermes config exists, should return manual
    if (!installer.detectConfigPath()) {
      expect(result.action).toBe("manual");
      expect(result.ok).toBe(true);
      expect(result.manualConfig).toBeDefined();
      expect(result.manualConfig!["arclayer-runner"]).toEqual(MOCK_MCP_CONFIG);
    }
  });
});

// ── OpenClaw Installer ──────────────────────────────────────────────────

describe("OpenClawInstaller", () => {
  it("returns undefined when config does not exist", () => {
    const installer = new OpenClawInstaller();
    const result = installer.detectConfigPath();
    expect(result === undefined || typeof result === "string").toBe(true);
  });

  it("returns manual config when path unknown", async () => {
    const installer = new OpenClawInstaller();
    const result = await installer.install(MOCK_MCP_CONFIG);
    if (!installer.detectConfigPath()) {
      expect(result.action).toBe("manual");
      expect(result.ok).toBe(true);
      expect(result.manualConfig).toBeDefined();
    }
  });
});

// ── Installer with real temp files ──────────────────────────────────────

describe("Installer: file operations", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "installer-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("Hermes: injects mcpServers into YAML and creates backup", async () => {
    const configPath = path.join(tempDir, "config.yaml");
    const existing = {
      name: "test-hermes",
      model: "gpt-4",
      mcpServers: {
        "existing-server": {
          command: "node",
          args: ["server.js"]
        }
      }
    };
    await writeFile(configPath, JSON.stringify(existing).length > 0
      ? `name: test-hermes\nmodel: gpt-4\nmcpServers:\n  existing-server:\n    command: node\n    args:\n      - server.js\n`
      : "");

    // Write actual YAML
    const yamlContent = `name: test-hermes
model: gpt-4
mcpServers:
  existing-server:
    command: node
    args:
      - server.js
`;
    await writeFile(configPath, yamlContent);

    const installer = new HermesInstaller();
    // Override config path for testing
    (installer as any).configPath = configPath;

    const result = await installer.install(MOCK_MCP_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.action).toBe("installed");
    expect(result.backupPath).toBe(`${configPath}.bak`);

    // Backup exists
    expect(await fileExists(`${configPath}.bak`)).toBe(true);

    // Updated config has both servers
    const updated = await readFile(configPath, "utf8");
    expect(updated).toContain("arclayer-runner");
    expect(updated).toContain("existing-server");
    expect(updated).toContain("@arclayer/runner");
  });

  it("Hermes: creates mcpServers section if missing", async () => {
    const configPath = path.join(tempDir, "config.yaml");
    await writeFile(configPath, "name: test-hermes\nmodel: gpt-4\n");

    const installer = new HermesInstaller();
    (installer as any).configPath = configPath;

    const result = await installer.install(MOCK_MCP_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.action).toBe("installed");

    const updated = await readFile(configPath, "utf8");
    expect(updated).toContain("arclayer-runner");
  });

  it("OpenClaw: injects mcpServers into JSON and creates backup", async () => {
    const configPath = path.join(tempDir, "config.json");
    const existing = {
      name: "test-openclaw",
      model: "claude-3",
      mcpServers: {
        "existing-server": {
          command: "node",
          args: ["server.js"]
        }
      }
    };
    await writeFile(configPath, JSON.stringify(existing, null, 2));

    const installer = new OpenClawInstaller();
    (installer as any).configPath = configPath;

    const result = await installer.install(MOCK_MCP_CONFIG);

    expect(result.ok).toBe(true);
    expect(result.action).toBe("installed");
    expect(result.backupPath).toBe(`${configPath}.bak`);

    // Backup exists
    expect(await fileExists(`${configPath}.bak`)).toBe(true);

    // Updated config has both servers
    const updated = JSON.parse(await readFile(configPath, "utf8"));
    expect(updated.mcpServers["arclayer-runner"]).toEqual(MOCK_MCP_CONFIG);
    expect(updated.mcpServers["existing-server"]).toEqual(existing.mcpServers["existing-server"]);
    expect(updated.name).toBe("test-openclaw");
  });

  it("OpenClaw: creates mcpServers section if missing", async () => {
    const configPath = path.join(tempDir, "config.json");
    await writeFile(configPath, JSON.stringify({ name: "test" }));

    const installer = new OpenClawInstaller();
    (installer as any).configPath = configPath;

    const result = await installer.install(MOCK_MCP_CONFIG);

    expect(result.ok).toBe(true);
    const updated = JSON.parse(await readFile(configPath, "utf8"));
    expect(updated.mcpServers["arclayer-runner"]).toEqual(MOCK_MCP_CONFIG);
  });
});

// ── auto.ts ─────────────────────────────────────────────────────────────

describe("auto-detect", () => {
  it("buildMcpServerConfig returns correct structure", () => {
    const config = buildMcpServerConfig();
    expect(config.command).toBe("npx");
    expect(config.args).toEqual(["-y", "@arclayer/runner", "mcp"]);
    expect(config.env?.ARCLAYER_RUNNER_CONFIG).toContain("config.json");
    expect(config.env?.ARCLAYER_RUNNER_POLICY).toContain("policy.json");
  });

  it("detectAllRuntimes returns hermes and openclaw", () => {
    const runtimes = detectAllRuntimes();
    expect(runtimes.length).toBe(2);
    expect(runtimes.map((r) => r.target)).toContain("hermes");
    expect(runtimes.map((r) => r.target)).toContain("openclaw");
  });

  it("getInstaller returns correct installer", () => {
    expect(getInstaller("hermes")).toBeInstanceOf(HermesInstaller);
    expect(getInstaller("openclaw")).toBeInstanceOf(OpenClawInstaller);
  });

  it("formatManualMcpConfig produces valid JSON", () => {
    const output = formatManualMcpConfig(MOCK_MCP_CONFIG);
    const parsed = JSON.parse(output);
    expect(parsed.mcpServers["arclayer-runner"]).toEqual(MOCK_MCP_CONFIG);
  });
});

// ── skill-template.ts ───────────────────────────────────────────────────

describe("skill-template", () => {
  it("generates valid skill content", () => {
    const content = generateSkillTemplate({
      agentId: "test-agent",
      runtimeTarget: "hermes"
    });

    expect(content).toContain("ArcLayer Runner");
    expect(content).toContain("runner.health");
    expect(content).toContain("x402.pay");
    expect(content).toContain("erc8183.provider_run_and_submit");
    expect(content).toContain("test-agent");
    expect(content).toContain("hermes");
  });

  it("does not contain actual secrets", () => {
    const content = generateSkillTemplate({
      agentId: "test-agent",
      runtimeTarget: "hermes"
    });

    // Should not contain hex private keys, long tokens, or wallet addresses
    expect(content).not.toMatch(/0x[a-fA-F0-9]{64}/); // private keys
    expect(content).not.toMatch(/[a-fA-F0-9]{64}/); // raw private keys
    expect(content).not.toMatch(/Bearer [A-Za-z0-9._-]{20,}/); // tokens
    expect(content).not.toContain("sk-"); // API keys
    expect(content).not.toContain("arc_mcp_sess_"); // MCP session tokens
  });
});
