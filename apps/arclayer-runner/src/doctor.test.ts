import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runDoctor } from "./doctor";
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
    circleWalletAddress: "0x0000000000000000000000000000000000000002",
    walletRail: "circle-dev",
    circleApiKey: "test-api-key",
    circleEntitySecret: "test-entity-secret",
    circleWalletId: "test-wallet-id",
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
    circle: { walletAddress: "0x0000000000000000000000000000000000000002", chain: "ARC-TESTNET" },
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

// ── Wallet adapter readiness checks ─────────────────────────────────────

describe("runDoctor: wallet adapter readiness", () => {
  it("reports wallet rail as circle-dev", async () => {
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "Wallet rail");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
    expect(check!.message).toContain("circle-dev");
  });

  it("reports Circle Dev Wallet API key configured", async () => {
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "Circle Dev Wallet API key");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
  });

  it("warns when API key missing", async () => {
    const results = await runDoctor(makeConfig({ circleApiKey: undefined }));
    const check = results.find((r) => r.name === "Circle Dev Wallet API key");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(false);
  });

  it("reports entity secret configured", async () => {
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "Circle Dev Wallet entity secret");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
  });

  it("warns when entity secret missing", async () => {
    const results = await runDoctor(makeConfig({ circleEntitySecret: undefined }));
    const check = results.find((r) => r.name === "Circle Dev Wallet entity secret");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(false);
  });

  it("reports wallet ID configured", async () => {
    const results = await runDoctor(makeConfig());
    const check = results.find((r) => r.name === "Circle wallet ID");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(true);
  });

  it("warns when wallet ID missing", async () => {
    const results = await runDoctor(makeConfig({ circleWalletId: undefined }));
    const check = results.find((r) => r.name === "Circle wallet ID");
    expect(check).toBeDefined();
    expect(check!.ok).toBe(false);
  });

  it("includes all expected wallet adapter check names", async () => {
    const results = await runDoctor(makeConfig());
    const names = results.map((r) => r.name);
    expect(names).toContain("Wallet rail");
    expect(names).toContain("Circle Dev Wallet API key");
    expect(names).toContain("Circle Dev Wallet entity secret");
    expect(names).toContain("Circle wallet ID");
  });
});

// ── Full check list ─────────────────────────────────────────────────────

describe("runDoctor: full check list", () => {
  it("includes all expected check names", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const names = results.map((r) => r.name);
    expect(names).toContain("config.json exists");
    expect(names).toContain("policy.json exists");
    expect(names).toContain("Wallet rail");
    expect(names).toContain("Circle Dev Wallet API key");
    expect(names).toContain("Circle Dev Wallet entity secret");
    expect(names).toContain("Circle wallet ID");
    expect(names).toContain("Global Skill");
    expect(names).toContain("Runtime endpoint");
    expect(names).toContain("Runner secret");
    expect(names).toContain("Payment enabled");
    expect(names).toContain("Local spending policy");
  });

  it("does not include any Circle CLI check names", async () => {
    await createLocalFiles();
    const results = await runDoctor(makeConfig());
    const names = results.map((r) => r.name);
    expect(names).not.toContain("Circle CLI binary");
    expect(names).not.toContain("Circle CLI version");
    expect(names).not.toContain("Circle wallet status");
    expect(names).not.toContain("Circle wallet policy");
    expect(names).not.toContain("Circle wallet budget");
    expect(names).not.toContain("Policy comparison (Runner vs Circle)");
  });
});
