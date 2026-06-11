import { describe, it, expect } from "vitest";
import { runDoctor, getCirclePolicyStatus } from "./doctor";
import type { RunnerConfig } from "@arclayer/runner-core";

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

describe("runDoctor", () => {
  it("includes Circle wallet policy check", async () => {
    const results = await runDoctor(makeConfig());
    const policyCheck = results.find((r) => r.name === "Circle wallet policy");
    expect(policyCheck).toBeDefined();
    // Circle CLI not installed in test env — should be skipped/fail
    expect(policyCheck!.ok).toBe(false);
    expect(policyCheck!.message).toBeDefined();
  });

  it("includes Circle wallet budget check", async () => {
    const results = await runDoctor(makeConfig());
    const budgetCheck = results.find((r) => r.name === "Circle wallet budget");
    expect(budgetCheck).toBeDefined();
    expect(budgetCheck!.ok).toBe(false);
    expect(budgetCheck!.message).toBeDefined();
  });

  it("includes policy comparison check", async () => {
    const results = await runDoctor(makeConfig());
    const comparison = results.find((r) => r.name === "Policy comparison (Runner vs Circle)");
    expect(comparison).toBeDefined();
    expect(comparison!.message).toBeDefined();
  });

  it("skips wallet checks when wallet not configured", async () => {
    const results = await runDoctor(makeConfig({ circleWalletAddress: undefined }));
    const policyCheck = results.find((r) => r.name === "Circle wallet policy");
    expect(policyCheck).toBeDefined();
    expect(policyCheck!.ok).toBe(false);
    expect(policyCheck!.message).toContain("wallet address not configured");
  });

  it("does not crash when Circle CLI not installed", async () => {
    const results = await runDoctor(makeConfig({ circleCliBin: "nonexistent-circle-cli" }));
    expect(results.length).toBeGreaterThan(0);
    // All checks should return, none should throw
    for (const check of results) {
      expect(check.name).toBeDefined();
      expect(check.message).toBeDefined();
    }
  });

  it("returns all expected check names", async () => {
    const results = await runDoctor(makeConfig());
    const names = results.map((r) => r.name);
    expect(names).toContain("Circle CLI binary");
    expect(names).toContain("Circle CLI version");
    expect(names).toContain("Circle wallet status");
    expect(names).toContain("Wallet address configured");
    expect(names).toContain("Gateway balance");
    expect(names).toContain("Circle wallet policy");
    expect(names).toContain("Circle wallet budget");
    expect(names).toContain("Policy comparison (Runner vs Circle)");
    expect(names).toContain("Global Skill");
    expect(names).toContain("Runtime endpoint");
    expect(names).toContain("Runner secret");
    expect(names).toContain("Payment enabled");
  });
});

describe("getCirclePolicyStatus", () => {
  it("returns runnerPolicy even when wallet not configured", async () => {
    const result = await getCirclePolicyStatus(makeConfig({ circleWalletAddress: undefined }));
    expect(result.ok).toBe(false);
    expect(result.runnerPolicy).toBeDefined();
    expect(result.runnerPolicy.perTxLimitUsdc).toBe("0.01");
    expect(result.runnerPolicy.dailyLimitUsdc).toBe("1");
    expect(result.runnerPolicy.monthlyLimitUsdc).toBe("20");
    expect(result.warnings).toContain("CIRCLE_WALLET_ADDRESS not configured");
  });

  it("returns warnings when Circle CLI fails", async () => {
    const result = await getCirclePolicyStatus(makeConfig({ circleCliBin: "nonexistent-cli" }));
    expect(result.ok).toBe(false);
    expect(result.runnerPolicy).toBeDefined();
    expect(result.warnings.length).toBeGreaterThan(0);
    // Should not crash
    expect(result.walletAddress).toBeDefined();
  });

  it("returns runnerPolicy with correct structure", async () => {
    const result = await getCirclePolicyStatus(makeConfig());
    expect(result.runnerPolicy).toHaveProperty("perTxLimitUsdc");
    expect(result.runnerPolicy).toHaveProperty("dailyLimitUsdc");
    expect(result.runnerPolicy).toHaveProperty("monthlyLimitUsdc");
    expect(result.runnerPolicy).toHaveProperty("batchMaxTotalUsdc");
    expect(result.runnerPolicy).toHaveProperty("paymentEnabled");
  });

  it("returns walletAddress and chain in response", async () => {
    const result = await getCirclePolicyStatus(makeConfig());
    expect(result.walletAddress).toBe("0x0000000000000000000000000000000000000002");
    expect(result.chain).toBe("ARC-TESTNET");
  });
});
