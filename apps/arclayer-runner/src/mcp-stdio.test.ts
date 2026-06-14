import { describe, it, expect, beforeEach } from "vitest";
import { executeRunnerMcpTool } from "./runner-mcp-executor";
import { RUNNER_MCP_TOOLS } from "./mcp-schemas";
import type { RunnerConfig } from "@arclayer/runner-core";
import type { McpToolContext } from "./mcp-tools";

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
    dataDir: ".test-stdio",
    port: 8787,
    runnerSecret: "stdio-local-process-isolation-no-http",
    ...overrides
  };
}

function makeMockServices(): any {
  return {
    manifest: () => ({ name: "ArcLayer Runner", runnerId: "test-runner" }),
    receipts: { list: async () => [] },
    getLedger: async () => ({ ok: true, records: [] }),
    circleStatus: async () => ({ ok: true, response: {} }),
    inspectX402: async () => ({ ok: true, result: {} }),
    payX402: async () => ({ ok: true, idempotencyKey: "test" }),
    batchPayX402: async () => ({ ok: true, results: [] }),
    prepareRegister: async () => ({ ok: true, mode: "prepare-only" }),
    runErc8183ProviderJob: async () => ({ ok: true, result: {} }),
    submitDeliverableViaCircleCli: async () => ({ ok: true }),
    circle: {
      gatewayBalance: async () => ({ ok: true }),
      walletBalance: async () => ({ ok: true }),
      walletBudget: async () => ({ ok: true })
    }
  };
}

function makeMockMcp(): any {
  return {
    getRuntimeContext: async () => ({ ok: true })
  };
}

function makeContext(overrides: Partial<RunnerConfig> = {}): McpToolContext {
  const config = makeConfig(overrides);
  return {
    services: makeMockServices(),
    mcp: makeMockMcp(),
    config,
    skill: { content: "# Skill", sha256: "abc123", path: "/test/skill.md" }
  };
}

// ── Unit tests: executeRunnerMcpTool ──────────────────────────────────────

describe("MCP Runner: executeRunnerMcpTool", () => {
  let ctx: McpToolContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  it("tools/call runner.health returns ok", async () => {
    const result = await executeRunnerMcpTool("runner.health", {}, ctx);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    const textBlock = result.content.find((c: any) => c.type === "text") as any;
    expect(textBlock).toBeDefined();
    const parsed = JSON.parse(textBlock.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.runnerId).toBe("test-runner");
  });

  it("tools/call x402.payment_policy returns policy", async () => {
    const result = await executeRunnerMcpTool("x402.payment_policy", {}, ctx);

    const textBlock = result.content.find((c: any) => c.type === "text") as any;
    const parsed = JSON.parse(textBlock.text);
    expect(parsed.paymentEnabled).toBe(true);
    expect(parsed.perTxLimitUsdc).toBe("0.01");
  });

  it("tools/call with unknown tool returns ROLE_TOOL_NOT_ALLOWED", async () => {
    const result = await executeRunnerMcpTool("nonexistent.tool", {}, ctx);

    const textBlock = result.content.find((c: any) => c.type === "text") as any;
    const parsed = JSON.parse(textBlock.text);
    expect(parsed.error).toContain("ROLE_TOOL_NOT_ALLOWED");
  });
});

// ── Role enforcement tests ─────────────────────────────────────────────────

describe("MCP Runner: Role enforcement", () => {
  it("provider cannot call x402.pay", async () => {
    const ctx = makeContext({ defaultRole: "provider", allowedRoles: ["provider"] });
    const result = await executeRunnerMcpTool("x402.pay", { url: "https://test.com", maxAmountUsdc: "0.01", reason: "test" }, ctx);
    const textBlock = result.content.find((c: any) => c.type === "text") as any;
    const parsed = JSON.parse(textBlock.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("ROLE_TOOL_NOT_ALLOWED");
  });

  it("provider cannot call erc8183.complete_job", async () => {
    const ctx = makeContext({ defaultRole: "provider", allowedRoles: ["provider"] });
    const result = await executeRunnerMcpTool("erc8183.complete_job", { jobId: "1", reason: "test" }, ctx);
    const textBlock = result.content.find((c: any) => c.type === "text") as any;
    const parsed = JSON.parse(textBlock.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("ROLE_TOOL_NOT_ALLOWED");
  });

  it("provider cannot call erc8183.claim_refund", async () => {
    const ctx = makeContext({ defaultRole: "provider", allowedRoles: ["provider"] });
    const result = await executeRunnerMcpTool("erc8183.claim_refund", { jobId: "1" }, ctx);
    const textBlock = result.content.find((c: any) => c.type === "text") as any;
    const parsed = JSON.parse(textBlock.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("ROLE_TOOL_NOT_ALLOWED");
  });

  it("evaluator can call erc8183.complete_job", async () => {
    const ctx = makeContext({ defaultRole: "evaluator", allowedRoles: ["evaluator"] });
    const result = await executeRunnerMcpTool("erc8183.complete_job", { jobId: "1", reason: "test" }, ctx);
    const textBlock = result.content.find((c: any) => c.type === "text") as any;
    const parsed = JSON.parse(textBlock.text);
    // Should NOT be blocked by role enforcement (may fail for other reasons like Circle CLI)
    expect(parsed.error).not.toBe("ROLE_TOOL_NOT_ALLOWED");
  });

  it("x402-agent can call x402.pay", async () => {
    const ctx = makeContext({ defaultRole: "x402-agent", allowedRoles: ["x402-agent"] });
    const result = await executeRunnerMcpTool("x402.pay", { url: "https://test.com", maxAmountUsdc: "0.01", reason: "test" }, ctx);
    const textBlock = result.content.find((c: any) => c.type === "text") as any;
    const parsed = JSON.parse(textBlock.text);
    // Should NOT be blocked by role enforcement
    expect(parsed.error).not.toBe("ROLE_TOOL_NOT_ALLOWED");
  });

  it("client can call erc8183.create_job", async () => {
    const ctx = makeContext({ defaultRole: "client", allowedRoles: ["client"] });
    const result = await executeRunnerMcpTool("erc8183.create_job", { provider: "0x0000000000000000000000000000000000000001", evaluator: "0x0000000000000000000000000000000000000002", expiredAt: "9999999999", description: "test" }, ctx);
    const textBlock = result.content.find((c: any) => c.type === "text") as any;
    const parsed = JSON.parse(textBlock.text);
    // Should NOT be blocked by role enforcement
    expect(parsed.error).not.toBe("ROLE_TOOL_NOT_ALLOWED");
  });

  it("provider can call runner.health (allowed tool)", async () => {
    const ctx = makeContext({ defaultRole: "provider", allowedRoles: ["provider"] });
    const result = await executeRunnerMcpTool("runner.health", {}, ctx);
    const textBlock = result.content.find((c: any) => c.type === "text") as any;
    const parsed = JSON.parse(textBlock.text);
    expect(parsed.ok).toBe(true);
  });

  it("provider cannot call circle.gateway_deposit", async () => {
    const ctx = makeContext({ defaultRole: "provider", allowedRoles: ["provider"] });
    const result = await executeRunnerMcpTool("circle.gateway_deposit", { amount: "1", method: "eco" }, ctx);
    const textBlock = result.content.find((c: any) => c.type === "text") as any;
    const parsed = JSON.parse(textBlock.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("ROLE_TOOL_NOT_ALLOWED");
  });
});
