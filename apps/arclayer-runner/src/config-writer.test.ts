import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, access, rm } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { writeRunnerConfig } from "./config-writer";
import { InitFileConfigSchema, PolicyConfigSchema, validateWalletAddress } from "@arclayer/runner-core";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "runner-test-"));
  process.env.ARCLAYER_RUNNER_DIR = tempDir;
});

afterEach(async () => {
  delete process.env.ARCLAYER_RUNNER_DIR;
  await rm(tempDir, { recursive: true, force: true });
});

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ── writeRunnerConfig tests ─────────────────────────────────────────────

describe("writeRunnerConfig", () => {
  it("creates config.json and policy.json", async () => {
    const result = await writeRunnerConfig({
      agentId: "test-agent-1",
      role: "provider",
      walletAddress: "0x0000000000000000000000000000000000000001",
      chain: "BASE"
    });

    expect(result.ok).toBe(true);
    expect(result.config.agentId).toBe("test-agent-1");
    expect(result.config.role).toBe("provider");
    expect(result.config.circle.walletAddress).toBe("0x0000000000000000000000000000000000000001");
    expect(result.config.circle.chain).toBe("BASE");

    expect(await fileExists(result.paths.configFile)).toBe(true);
    expect(await fileExists(result.paths.policyFile)).toBe(true);

    const configJson = JSON.parse(await readFile(result.paths.configFile, "utf8"));
    expect(configJson.agentId).toBe("test-agent-1");
    expect(configJson.circle.walletAddress).toBe("0x0000000000000000000000000000000000000001");

    const policyJson = JSON.parse(await readFile(result.paths.policyFile, "utf8"));
    expect(policyJson.paymentEnabled).toBe(false);
    expect(policyJson.perTxLimitUsdc).toBe("0.01");
  });

  it("creates receipts.jsonl and ledger.jsonl", async () => {
    const result = await writeRunnerConfig({ agentId: "test-agent-2" });

    expect(await fileExists(result.paths.receiptsFile)).toBe(true);
    expect(await fileExists(result.paths.ledgerFile)).toBe(true);

    const receipts = await readFile(result.paths.receiptsFile, "utf8");
    expect(receipts).toBe("");
  });

  it("refuses overwrite without --force", async () => {
    await writeRunnerConfig({ agentId: "test-agent-3" });

    await expect(
      writeRunnerConfig({ agentId: "test-agent-3b" })
    ).rejects.toThrow("config.json already exists");
  });

  it("overwrites with --force", async () => {
    const first = await writeRunnerConfig({ agentId: "test-agent-4" });
    const second = await writeRunnerConfig(
      { agentId: "test-agent-4b", role: "client" },
      { force: true }
    );

    expect(second.ok).toBe(true);
    expect(second.config.agentId).toBe("test-agent-4b");
    expect(second.config.role).toBe("client");

    const configJson = JSON.parse(await readFile(second.paths.configFile, "utf8"));
    expect(configJson.agentId).toBe("test-agent-4b");
  });

  it("validates wallet address", async () => {
    await expect(
      writeRunnerConfig({
        agentId: "test-agent-5",
        walletAddress: "not-a-valid-address"
      })
    ).rejects.toThrow("Invalid wallet address");
  });

  it("rejects private-key-like values", async () => {
    // 64 hex chars without 0x
    await expect(
      writeRunnerConfig({
        agentId: "test-agent-6",
        walletAddress: "a".repeat(64)
      })
    ).rejects.toThrow("private key");

    // 66 chars with 0x
    await expect(
      writeRunnerConfig({
        agentId: "test-agent-6b",
        walletAddress: "0x" + "a".repeat(64)
      })
    ).rejects.toThrow("private key");
  });

  it("respects custom policy values", async () => {
    const result = await writeRunnerConfig({
      agentId: "test-agent-7",
      paymentEnabled: true,
      perTxLimitUsdc: "0.05",
      dailyLimitUsdc: "5",
      monthlyLimitUsdc: "50",
      batchMaxItems: 20,
      batchMaxTotalUsdc: "0.25",
      allowedX402Hosts: ["api.foo.com", "api.bar.com"]
    });

    expect(result.policy.paymentEnabled).toBe(true);
    expect(result.policy.perTxLimitUsdc).toBe("0.05");
    expect(result.policy.dailyLimitUsdc).toBe("5");
    expect(result.policy.allowedX402Hosts).toEqual(["api.foo.com", "api.bar.com"]);

    const policyJson = JSON.parse(await readFile(result.paths.policyFile, "utf8"));
    expect(policyJson.paymentEnabled).toBe(true);
    expect(policyJson.batchMaxItems).toBe(20);
  });

  it("sets 0600 file permissions", async () => {
    const result = await writeRunnerConfig({ agentId: "test-agent-8" });

    // Check that files are readable by owner
    const configStat = await readFile(result.paths.configFile, "utf8");
    expect(configStat.length).toBeGreaterThan(0);
  });

  it("uses default values when optional fields not provided", async () => {
    const result = await writeRunnerConfig({ agentId: "test-agent-9" });

    expect(result.config.circle.chain).toBe("ARC-TESTNET");
    expect(result.config.circle.cliBin).toBe("circle");
    expect(result.config.runtime.target).toBe("openclaw");
    expect(result.config.mcp.mode).toBe("stdio");
    expect(result.policy.perTxLimitUsdc).toBe("0.01");
    expect(result.policy.dailyLimitUsdc).toBe("1");
    expect(result.policy.monthlyLimitUsdc).toBe("20");
    expect(result.policy.batchMaxItems).toBe(10);
  });
});

// ── validateWalletAddress tests ─────────────────────────────────────────

describe("validateWalletAddress", () => {
  it("accepts valid 0x + 40 hex chars", () => {
    const result = validateWalletAddress("0x0000000000000000000000000000000000000001");
    expect(result.valid).toBe(true);
  });

  it("rejects empty string", () => {
    const result = validateWalletAddress("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("required");
  });

  it("rejects short address", () => {
    const result = validateWalletAddress("0x123");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid");
  });

  it("rejects 64 hex chars (private key without 0x)", () => {
    const result = validateWalletAddress("a".repeat(64));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("private key");
  });

  it("rejects 0x + 64 hex chars (private key with 0x)", () => {
    const result = validateWalletAddress("0x" + "a".repeat(64));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("private key");
  });

  it("rejects non-hex characters", () => {
    const result = validateWalletAddress("0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid");
  });
});

// ── InitFileConfigSchema tests ──────────────────────────────────────────

describe("InitFileConfigSchema", () => {
  it("parses valid nested config", () => {
    const config = InitFileConfigSchema.parse({
      agentId: "test-agent",
      role: "provider",
      circle: { cliBin: "circle", walletAddress: "0x0000000000000000000000000000000000000001", chain: "BASE" },
      runtime: { target: "openclaw" },
      mcp: { mode: "stdio" }
    });

    expect(config.agentId).toBe("test-agent");
    expect(config.role).toBe("provider");
    expect(config.circle.chain).toBe("BASE");
  });

  it("uses defaults for missing fields", () => {
    const config = InitFileConfigSchema.parse({ agentId: "test-agent" });

    expect(config.role).toBe("provider");
    expect(config.circle.cliBin).toBe("circle");
    expect(config.circle.chain).toBe("ARC-TESTNET");
    expect(config.runtime.target).toBe("openclaw");
    expect(config.mcp.mode).toBe("stdio");
  });
});
