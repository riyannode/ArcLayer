import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runDoctor, getCirclePolicyStatus } from "./doctor";
import type { RunnerConfig } from "@arclayer/runner-core";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "doctor-test-"));
  process.env.ARCLAYER_RUNNER_DIR = tempDir;
});

afterEach(async () => {
  delete process.env.ARCLAYER_RUNNER_DIR;
  await rm(tempDir, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    runnerId: "test-runner",
    agentId: "agent-1",
    agentAddress: "0x0000000000000000000000000000000000000001",
    runtimeKind: "hermes",
    runtimeEndpoint: "http://127.0.0.1:8642",
    runtimeRunPath: "/run",
    defaultRole: "provider",
    allowedRoles: ["provider"],
    chain: "ARC-TESTNET",
    circleCliBin: "circle",
    circleWalletAddress: "0x0000000000000000000000000000000000000002",
    paymentEnabled: true,
    perTxLimitUsdc: "0.01",
    dailyLimitUsdc: "1",
    monthlyLimitUsdc: "20",
    batchMaxItems: 10,
    batchMaxTotalUsdc: "0.05",
    allowedX402Hosts: ["api.example.com"],
    dataDir: ".test-doctor",
    port: 8787,
    runnerSecret: "test-secret-at-least-16-chars",
    ...overrides
  };
}

/**
 * Create local config/policy files in temp dir for doctor to find.
 */
async function createLocalFiles(overrides: {
  config?: object;
  policy?: object;
} = {}) {
  const config = overrides.config ?? {
    agentId: "agent-1",
    role: "provider",
    circle: { cliBin: "circle", walletAddress: "0x0000000000000000000000000000000000000002", chain: "ARC-TESTNET" },
    runtime: { target: "hermes" },
    mcp: { mode: "stdio" }
  };
  const policy = overrides.policy ?? {
    paymentEnabled: true,
    perTxLimitUsdc: "0.01",
    dailyLimitUsdc: "1",
    monthlyLimitUsdc: "20",
    batchMaxItems: 10,
    batchMaxTotalUsdc: "0.05",
    allowedX402Hosts: ["api.example.com"]
  };

  await writeFile(path.join(tempDir, "config.json"), JSON.stringify(config, null, 2));
  await writeFile(path.join(tempDir, "policy.json"), JSON.stringify(policy, null, 2));
  await writeFile(path.join(tempDir, "receipts.jsonl"), "");
  await writeFile(path.join(tempDir, "ledger.jsonl"), "");
}

// ── Local file checks ───────────────────────────────────────────────────

describe("runDoctor: local file checks", () => {
  it("detects config.json exists", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "config.json exists");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
  });

  it("detects config.json missing", async () => {
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "config.json exists");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(false);
  });

  it("detects policy.json exists", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "policy.json exists");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
  });

  it("detects policy.json missing", async () => {
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "policy.json exists");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(false);
  });

  it("detects receipts.jsonl exists", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "receipts.jsonl exists");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
  });

  it("detects ledger.jsonl missing gracefully", async () => {
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "ledger.jsonl exists");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(false);
    expect(check!.message).toContain("will be created");
  });

  it("validates config.json parses", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "config.json parses");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
  });

  it("validates policy.json parses", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "policy.json parses");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
  });

  it("validates config.json schema", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "config.json schema valid");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
  });

  it("validates policy.json schema", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "policy.json schema valid");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
  });

  it("checks wallet address is valid EVM address", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "Wallet address valid");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
  });

  it("warns when wallet not configured", async () => {
    const results = await runDoctor(makeConfig({ circleWalletAddress: undefined }));
    const check = results.find((r) => r.name === "Wallet address configured");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(false);
  });

  it("validates role", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "Role valid");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
    expect(check!.message).toContain("provider");
  });

  it("validates runtime target", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "Runtime target valid");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
    expect(check!.message).toContain("hermes");
  });

  it("validates local spending policy", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "Local spending policy");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
  });
});

// ── Circle CLI advisory checks ──────────────────────────────────────────

describe("runDoctor: Circle CLI checks", () => {
  it("warns but does not crash when Circle CLI not installed", async () => {
    const results = await runDoctor(makeConfig({ circleCliBin: "nonexistent-circle-cli" }));
    expect(results.length).toBeGreaterThan(0);
    for (const check of results) {
      expect(check.name).toBeDefined();
      expect(check.message).toBeDefined();
    }
    const cliCheck = results.find((r) => r.name === "Circle CLI binary");
    expect(cliCheck!.ok).toBe(false);
  });

  it("includes all expected check names", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const names = results.map((r) => r.name);
    expect(names).toContain("config.json exists");
    expect(names).toContain("policy.json exists");
    expect(names).toContain("Circle CLI binary");
    expect(names).toContain("Circle CLI version");
    expect(names).toContain("Circle wallet status");
    expect(names).toContain("Circle wallet policy");
    expect(names).toContain("Global Skill");
    expect(names).toContain("Runtime endpoint");
    expect(names).toContain("Runner secret");
    expect(names).toContain("Payment enabled");
    expect(names).toContain("Local spending policy");
  });
});

// ── Unsupported chain handling ──────────────────────────────────────────

describe("runDoctor: unsupported chain handling", () => {
  it("skips Circle wallet policy check on ARC-TESTNET", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig({ chain: "ARC-TESTNET" }));
    const policyCheck = results.find((r) => r.name === "Circle wallet policy");
    expect(policyCheck).toBeDefined();
    expect(policyCheck!.ok).toBe(true);
    expect(policyCheck!.message).toContain("Skipped");
    expect(policyCheck!.message).toContain("ARC-TESTNET");
  });

  it("skips Circle wallet budget check on ARC-TESTNET", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig({ chain: "ARC-TESTNET" }));
    const budgetCheck = results.find((r) => r.name === "Circle wallet budget");
    expect(budgetCheck).toBeDefined();
    expect(budgetCheck!.ok).toBe(true);
    expect(budgetCheck!.message).toContain("Skipped");
  });

  it("skips policy comparison on ARC-TESTNET", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig({ chain: "ARC-TESTNET" }));
    const comparison = results.find((r) => r.name === "Policy comparison (Runner vs Circle)");
    expect(comparison).toBeUndefined();
  });
});

// ── getCirclePolicyStatus ───────────────────────────────────────────────

describe("getCirclePolicyStatus", () => {
  it("returns runnerPolicy even when wallet not configured", async () => {
    const result = await getCirclePolicyStatus(makeConfig({ circleWalletAddress: undefined }));
    expect(result.ok).toBe(false);
    expect(result.runnerPolicy).toBeDefined();
    expect(result.runnerPolicy.perTxLimitUsdc).toBe("0.01");
    expect(result.warnings).toContain("CIRCLE_WALLET_ADDRESS not configured");
  });

  it("skips on unsupported chain", async () => {
    const result = await getCirclePolicyStatus(makeConfig({ chain: "ARC-TESTNET" }));
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("Chain 'ARC-TESTNET' does not support wallet policy checks");
  });

  it("returns warnings when Circle CLI fails", async () => {
    const result = await getCirclePolicyStatus(makeConfig({ circleCliBin: "nonexistent-cli", chain: "BASE" }));
    expect(result.ok).toBe(false);
    expect(result.runnerPolicy).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns runnerPolicy with correct structure", async () => {
    const result = await getCirclePolicyStatus(makeConfig());
    expect(result.runnerPolicy).toHaveProperty("perTxLimitUsdc");
    expect(result.runnerPolicy).toHaveProperty("dailyLimitUsdc");
    expect(result.runnerPolicy).toHaveProperty("monthlyLimitUsdc");
    expect(result.runnerPolicy).toHaveProperty("batchMaxTotalUsdc");
    expect(result.runnerPolicy).toHaveProperty("paymentEnabled");
  });
});
