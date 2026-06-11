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
    erc8183ContractAddress: "0x0747EEf0706327138c69792bF28Cd525089e4583",
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
    expect(parsed.error).toContain("Unknown tool");
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
