import { describe, it, expect, beforeEach } from "vitest";
import { PassThrough } from "node:stream";
import { handleStdioRequest, runMcpStdio } from "./mcp-stdio";
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

// ── Unit tests: handleStdioRequest ──────────────────────────────────────────

describe("MCP STDIO: handleStdioRequest", () => {
  let ctx: McpToolContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  it("initialize returns server info and capabilities", async () => {
    const result = await handleStdioRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "hermes", version: "1.0.0" }
        }
      },
      ctx
    );

    expect(result).toBeDefined();
    expect(result!.id).toBe(1);
    expect((result!.result as any).protocolVersion).toBe("2024-11-05");
    expect((result!.result as any).capabilities.tools).toEqual({});
    expect((result!.result as any).serverInfo.name).toBe("arclayer-runner");
  });

  it("tools/list returns all RUNNER_MCP_TOOLS", async () => {
    const result = await handleStdioRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ctx
    );

    expect(result).toBeDefined();
    const tools = (result!.result as any).tools;
    expect(tools.length).toBe(RUNNER_MCP_TOOLS.length);

    const names = tools.map((t: any) => t.name);
    expect(names).toContain("runner.health");
    expect(names).toContain("x402.pay");
    expect(names).toContain("erc8183.provider_run_and_submit");
  });

  it("tools/call runner.health returns ok", async () => {
    const result = await handleStdioRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "runner.health", arguments: {} }
      },
      ctx
    );

    expect(result).toBeDefined();
    const content = (result!.result as any).content;
    expect(content).toBeDefined();
    expect(content[0].type).toBe("text");
    const parsed = JSON.parse(content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.runnerId).toBe("test-runner");
  });

  it("tools/call x402.payment_policy returns policy", async () => {
    const result = await handleStdioRequest(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "x402.payment_policy", arguments: {} }
      },
      ctx
    );

    const parsed = JSON.parse((result!.result as any).content[0].text);
    expect(parsed.paymentEnabled).toBe(true);
    expect(parsed.perTxLimitUsdc).toBe("0.01");
  });

  it("tools/call with missing name returns -32602", async () => {
    const result = await handleStdioRequest(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { arguments: {} }
      },
      ctx
    );

    expect(result!.error).toBeDefined();
    expect(result!.error!.code).toBe(-32602);
    expect(result!.error!.message).toContain("Missing tool name");
  });

  it("tools/call with unknown tool returns content with error", async () => {
    const result = await handleStdioRequest(
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "nonexistent.tool", arguments: {} }
      },
      ctx
    );

    const parsed = JSON.parse((result!.result as any).content[0].text);
    expect(parsed.error).toContain("ROLE_TOOL_NOT_ALLOWED");
  });

  it("unknown method returns -32601", async () => {
    const result = await handleStdioRequest(
      { jsonrpc: "2.0", id: 7, method: "unknown/method" },
      ctx
    );

    expect(result!.error).toBeDefined();
    expect(result!.error!.code).toBe(-32601);
    expect(result!.error!.message).toContain("Method not found");
  });

  it("ping returns empty result", async () => {
    const result = await handleStdioRequest(
      { jsonrpc: "2.0", id: 8, method: "ping" },
      ctx
    );

    expect(result!.result).toEqual({});
  });

  it("notifications (no id) return undefined", async () => {
    const result = await handleStdioRequest(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      ctx
    );

    expect(result).toBeUndefined();
  });
});

// ── Integration tests: runMcpStdio with streams ─────────────────────────────

describe("MCP STDIO: runMcpStdio stream integration", () => {
  let ctx: McpToolContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  async function runStdioRoundTrip(inputs: string[]): Promise<string[]> {
    const input = new PassThrough();
    const output = new PassThrough();
    const outputLines: string[] = [];

    output.on("data", (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      outputLines.push(...lines);
    });

    const runPromise = runMcpStdio(ctx, input, output);

    for (const line of inputs) {
      input.write(line + "\n");
    }
    input.end();

    await runPromise;
    return outputLines;
  }

  it("handles initialize → tools/list → tools/call sequence", async () => {
    const lines = await runStdioRoundTrip([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "test" } } }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "runner.health", arguments: {} } })
    ]);

    expect(lines.length).toBe(3); // 3 responses (notification has no response)

    const init = JSON.parse(lines[0]);
    expect(init.result.protocolVersion).toBe("2024-11-05");

    const list = JSON.parse(lines[1]);
    expect(list.result.tools.length).toBe(RUNNER_MCP_TOOLS.length);

    const call = JSON.parse(lines[2]);
    const parsed = JSON.parse(call.result.content[0].text);
    expect(parsed.ok).toBe(true);
  });

  it("handles parse error gracefully", async () => {
    const lines = await runStdioRoundTrip(["not valid json"]);

    expect(lines.length).toBe(1);
    const err = JSON.parse(lines[0]);
    expect(err.error.code).toBe(-32700);
  });

  it("handles invalid JSON-RPC (missing jsonrpc field)", async () => {
    const lines = await runStdioRoundTrip([
      JSON.stringify({ id: 1, method: "test" })
    ]);

    expect(lines.length).toBe(1);
    const err = JSON.parse(lines[0]);
    expect(err.error.code).toBe(-32600);
  });
});

// ── Role enforcement tests ─────────────────────────────────────────────────

describe("MCP STDIO: Role enforcement at tools/call", () => {
  it("provider cannot call x402.pay", async () => {
    const ctx = makeContext({ defaultRole: "provider", allowedRoles: ["provider"] });
    const result = await handleStdioRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x402.pay", arguments: { url: "https://test.com", maxAmountUsdc: "0.01", reason: "test" } } },
      ctx
    );
    const parsed = JSON.parse((result!.result as any).content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("ROLE_TOOL_NOT_ALLOWED");
  });

  it("provider cannot call erc8183.complete_job", async () => {
    const ctx = makeContext({ defaultRole: "provider", allowedRoles: ["provider"] });
    const result = await handleStdioRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "erc8183.complete_job", arguments: { jobId: "1", reason: "test" } } },
      ctx
    );
    const parsed = JSON.parse((result!.result as any).content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("ROLE_TOOL_NOT_ALLOWED");
  });

  it("provider cannot call erc8183.claim_refund", async () => {
    const ctx = makeContext({ defaultRole: "provider", allowedRoles: ["provider"] });
    const result = await handleStdioRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "erc8183.claim_refund", arguments: { jobId: "1" } } },
      ctx
    );
    const parsed = JSON.parse((result!.result as any).content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("ROLE_TOOL_NOT_ALLOWED");
  });

  it("evaluator can call erc8183.complete_job", async () => {
    const ctx = makeContext({ defaultRole: "evaluator", allowedRoles: ["evaluator"] });
    const result = await handleStdioRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "erc8183.complete_job", arguments: { jobId: "1", reason: "test" } } },
      ctx
    );
    // Should NOT be blocked by role enforcement (may fail for other reasons like Circle CLI)
    const parsed = JSON.parse((result!.result as any).content[0].text);
    expect(parsed.error).not.toBe("ROLE_TOOL_NOT_ALLOWED");
  });

  it("x402-agent can call x402.pay", async () => {
    const ctx = makeContext({ defaultRole: "x402-agent", allowedRoles: ["x402-agent"] });
    const result = await handleStdioRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x402.pay", arguments: { url: "https://test.com", maxAmountUsdc: "0.01", reason: "test" } } },
      ctx
    );
    // Should NOT be blocked by role enforcement
    const parsed = JSON.parse((result!.result as any).content[0].text);
    expect(parsed.error).not.toBe("ROLE_TOOL_NOT_ALLOWED");
  });

  it("client can call erc8183.create_job", async () => {
    const ctx = makeContext({ defaultRole: "client", allowedRoles: ["client"] });
    const result = await handleStdioRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "erc8183.create_job", arguments: { provider: "0x0000000000000000000000000000000000000001", evaluator: "0x0000000000000000000000000000000000000002", expiredAt: "9999999999", description: "test" } } },
      ctx
    );
    // Should NOT be blocked by role enforcement
    const parsed = JSON.parse((result!.result as any).content[0].text);
    expect(parsed.error).not.toBe("ROLE_TOOL_NOT_ALLOWED");
  });

  it("provider can call runner.health (allowed tool)", async () => {
    const ctx = makeContext({ defaultRole: "provider", allowedRoles: ["provider"] });
    const result = await handleStdioRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "runner.health", arguments: {} } },
      ctx
    );
    const parsed = JSON.parse((result!.result as any).content[0].text);
    expect(parsed.ok).toBe(true);
  });

  it("provider cannot call circle.gateway_deposit", async () => {
    const ctx = makeContext({ defaultRole: "provider", allowedRoles: ["provider"] });
    const result = await handleStdioRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "circle.gateway_deposit", arguments: { amount: "1", method: "eco" } } },
      ctx
    );
    const parsed = JSON.parse((result!.result as any).content[0].text);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("ROLE_TOOL_NOT_ALLOWED");
  });
});
