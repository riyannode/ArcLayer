/**
 * ArcLayer Runner MCP — Official SDK End-to-End Tests.
 *
 * Tests the full transport chain:
 *   Official MCP Client → McpServer (local + proxy tools) → Broker → Executor → Handler
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRunnerMcpServer } from "./runner-mcp-server";
import { McpToolBroker, type ToolBudgetConfig } from "./mcp-broker";
import type { RunnerConfig } from "@arclayer/runner-core";
import type { McpToolContext } from "./mcp-tools";

// ── Helpers ───────────────────────────────────────────────────────────────

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
    dataDir: ".test-e2e",
    port: 8787,
    runnerSecret: "test-secret",
    toolBrokerEnabled: true,
    toolMaxCalls: 50,
    toolMaxTotalUsdc: "1",
    toolDefaultTimeoutMs: 30_000,
    toolMaxOutputBytes: 1_048_576,
    skillPath: "/test/skill.md",
    ...overrides,
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
      walletBudget: async () => ({ ok: true }),
    },
    close: undefined,
  };
}

function makeMockMcp(): any {
  return {
    getRuntimeContext: async () => ({ ok: true }),
    callTool: async (name: string, _args: any) => {
      if (name === "provider.runtime_heartbeat") return { ok: true, heartbeat: true };
      if (name === "provider.runtime_get_context") return { ok: true, context: {} };
      if (name === "jobs.list_public") return { ok: true, jobs: [] };
      return { ok: true, proxied: true, tool: name };
    },
  };
}

function makeContext(overrides: Partial<RunnerConfig> = {}): McpToolContext {
  const config = makeConfig(overrides);
  const brokerBudget: ToolBudgetConfig = {
    maxTotalUsdc: config.toolMaxTotalUsdc,
    maxCalls: config.toolMaxCalls,
    defaultTimeoutMs: config.toolDefaultTimeoutMs,
    maxOutputBytes: config.toolMaxOutputBytes,
  };
  const broker = new McpToolBroker(brokerBudget);
  return {
    services: makeMockServices(),
    mcp: makeMockMcp(),
    config,
    skill: { content: "# Skill", sha256: "abc123", path: "/test/skill.md" },
    broker,
  };
}

/**
 * Create a connected Client↔Server pair using InMemoryTransport.
 */
async function createConnectedPair(ctx: McpToolContext) {
  const server = createRunnerMcpServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);

  return { client, server };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Runner MCP: Official SDK E2E", () => {
  let ctx: McpToolContext;

  beforeEach(() => {
    ctx = makeContext();
  });

  it("initialize succeeds and returns server info", async () => {
    const { client, server } = await createConnectedPair(ctx);
    expect(client).toBeDefined();
    await server.close();
  });

  it("tools/list returns role-filtered tools for provider", async () => {
    const { client, server } = await createConnectedPair(ctx);
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);

    // Provider should see local tools
    expect(toolNames).toContain("runner.health");
    expect(toolNames).toContain("runner.manifest");
    expect(toolNames).toContain("runner.policy");

    // Provider should see Console proxy tools
    expect(toolNames).toContain("provider.runtime_heartbeat");
    expect(toolNames).toContain("provider.runtime_get_context");
    expect(toolNames).toContain("provider.runtime_write_checkpoint");
    expect(toolNames).toContain("jobs.list_public");
    expect(toolNames).toContain("jobs.get_public");
    expect(toolNames).toContain("identity.prepare_register_agent");

    // Provider should NOT see tools for other roles
    expect(toolNames).not.toContain("x402.pay"); // x402-agent only
    expect(toolNames).not.toContain("circle.gateway_deposit"); // devops-admin only

    await server.close();
  });

  it("tools/list returns different tools for client role", async () => {
    const ctxClient = makeContext({ defaultRole: "client", allowedRoles: ["client"] });
    const { client, server } = await createConnectedPair(ctxClient);
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);

    expect(toolNames).toContain("runner.health");
    expect(toolNames).toContain("client.prepare_create_job");
    expect(toolNames).toContain("client.prepare_approve_usdc");
    expect(toolNames).toContain("erc8183.create_job");

    // Client should NOT see provider-only tools
    expect(toolNames).not.toContain("provider.runtime_heartbeat");
    expect(toolNames).not.toContain("erc8183.provider_run_job");

    await server.close();
  });

  it("callTool runner.health succeeds", async () => {
    const { client, server } = await createConnectedPair(ctx);
    const result = await client.callTool({ name: "runner.health" });

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);

    const text = (result.content as any[])[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.runnerId).toBe("test-runner");
    expect(parsed.agentId).toBe("agent-1");

    await server.close();
  });

  it("callTool proxy tool reaches Console MCP via mock", async () => {
    const { client, server } = await createConnectedPair(ctx);
    const result = await client.callTool({ name: "provider.runtime_heartbeat" });

    expect(result.isError).toBeFalsy();
    const text = (result.content as any[])[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.heartbeat).toBe(true);

    await server.close();
  });

  it("callTool proxy tool jobs.list_public works", async () => {
    const { client, server } = await createConnectedPair(ctx);
    const result = await client.callTool({ name: "jobs.list_public", arguments: {} });

    expect(result.isError).toBeFalsy();
    const text = (result.content as any[])[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.jobs).toEqual([]);

    await server.close();
  });

  it("callTool for unregistered tool returns MCP error", async () => {
    const { client, server } = await createConnectedPair(ctx);

    // x402.pay is not registered for provider role — server returns tool-not-found
    const result = await client.callTool({ name: "x402.pay", arguments: { url: "https://example.com", method: "GET", maxAmountUsdc: "0.01", reason: "test" } });

    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text;
    // SDK returns "MCP error -32602: Tool ... not found" for unregistered tools
    expect(text).toContain("not found");

    await server.close();
  });

  it("callTool with invalid args returns error", async () => {
    const { client, server } = await createConnectedPair(ctx);

    // runner.receipts expects { limit: number }, pass string
    const result = await client.callTool({ name: "runner.receipts", arguments: { limit: "not-a-number" } });

    // SDK schema validation should reject this
    expect(result.isError).toBe(true);

    await server.close();
  });

  it("maxCalls enforced after limit reached", async () => {
    const ctxLimited = makeContext({ toolMaxCalls: 2 });
    const { client, server } = await createConnectedPair(ctxLimited);

    // First two calls succeed
    const r1 = await client.callTool({ name: "runner.health" });
    expect(r1.isError).toBeFalsy();

    const r2 = await client.callTool({ name: "runner.health" });
    expect(r2.isError).toBeFalsy();

    // Third call blocked by maxCalls
    const r3 = await client.callTool({ name: "runner.health" });
    expect(r3.isError).toBe(true);
    const text = (r3.content as any[])[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.error).toBe("BROKER_MAX_CALLS_EXCEEDED");

    await server.close();
  });

  it("audit entry written after successful call", async () => {
    const { client, server } = await createConnectedPair(ctx);

    await client.callTool({ name: "runner.health" });

    const broker = ctx.broker!;
    const log = broker.getAuditLog();
    expect(log.length).toBeGreaterThanOrEqual(1);

    const lastEntry = log[log.length - 1];
    expect(lastEntry.toolName).toBe("runner.health");
    expect(lastEntry.ok).toBe(true);
    expect(lastEntry.durationMs).toBeGreaterThanOrEqual(0);

    await server.close();
  });

  it("tools/list has no duplicate tool names", async () => {
    const { client, server } = await createConnectedPair(ctx);
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
    await server.close();
  });

  it("all tools have descriptions", async () => {
    const { client, server } = await createConnectedPair(ctx);
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThan(0);
    }
    await server.close();
  });

  it("callTool returns structuredContent for object results", async () => {
    const { client, server } = await createConnectedPair(ctx);
    const result = await client.callTool({ name: "runner.health" });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.ok).toBe(true);
    expect(structured.runnerId).toBe("test-runner");

    await server.close();
  });

  it("error messages are sanitized (no internal paths)", async () => {
    const ctxWithPath = makeContext();
    const originalServices = ctxWithPath.services as any;
    ctxWithPath.services = {
      ...originalServices,
      manifest: () => {
        throw new Error("ENOENT: no such file or directory, open '/root/.config/arclayer/skill.md'");
      },
    };

    const { client, server } = await createConnectedPair(ctxWithPath);
    const result = await client.callTool({ name: "runner.manifest" });

    expect(result.isError).toBe(true);
    const text = (result.content as any[])[0].text;
    const parsed = JSON.parse(text);

    // Should NOT contain the raw internal path
    expect(parsed.message).not.toContain("/root/.config");
    // Should contain sanitized placeholder
    expect(parsed.message).toContain("[path]");

    await server.close();
  });

  it("server close is idempotent", async () => {
    const { client, server } = await createConnectedPair(ctx);
    await server.close();
    await server.close(); // second close should not throw
  });
});

// ── Connector reconnect safety ────────────────────────────────────────────

describe("ArcLayerMcpConnector: reconnect safety", () => {
  it("connector rejects calls after close()", async () => {
    const { ArcLayerMcpConnector } = await import("./mcp-connector");

    const connector = new ArcLayerMcpConnector({
      baseUrl: "http://127.0.0.1:9999",
      agentId: "test-agent",
    });

    connector.close();

    await expect(connector.callTool("test")).rejects.toThrow("Connector is closed");
  });
});
