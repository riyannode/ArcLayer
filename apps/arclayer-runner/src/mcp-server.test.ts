import { describe, it, expect, beforeEach } from "vitest";
import { handleMcpRequest } from "./mcp-server";
import { RUNNER_MCP_TOOLS } from "./mcp-schemas";
import { getToolsForRole } from "./tool-registry";
import { McpToolBroker, BrokerErrorCode } from "./mcp-broker";
import type { RunnerConfig } from "@arclayer/runner-core";
import type { RunnerServices } from "./services";
import type { ArcLayerMcpConnector } from "./mcp-connector";
import type { ServerResponse } from "node:http";

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
    allowGatewayDeposit: false,
    allowIdentityRegister: false,
    toolBrokerEnabled: true,
    toolMaxCalls: 100,
    toolMaxTotalUsdc: "10",
    toolDefaultTimeoutMs: 30_000,
    toolMaxOutputBytes: 1_048_576,
    dataDir: ".test-mcp",
    port: 8787,
    runnerSecret: "test-secret-at-least-16-chars",
    ...overrides
  };
}

function makeMockRes(): { res: ServerResponse; output: () => { status: number; body: string } } {
  let statusCode = 200;
  let body = "";
  const headers: Record<string, string> = {};

  const res = {
    set statusCode(v: number) { statusCode = v; },
    get statusCode() { return statusCode; },
    setHeader(k: string, v: string) { headers[k] = v; },
    end(data: string) { body = data; }
  } as unknown as ServerResponse;

  return {
    res,
    output: () => ({ status: statusCode, body })
  };
}

function makeMockServices(): any {
  return {
    manifest: () => ({ name: "ArcLayer Runner", runnerId: "test-runner" }),
    receipts: { list: async (n: number) => [] },
    getLedger: async (n: number) => ({ ok: true, records: [] }),
    circleStatus: async () => ({ ok: true, response: {} }),
    inspectX402: async (body: unknown) => ({ ok: true, result: {} }),
    payX402: async (body: unknown) => ({ ok: true, idempotencyKey: "test" }),
    batchPayX402: async (body: unknown) => ({ ok: true, results: [] }),
    prepareRegister: async (body: unknown) => ({ ok: true, mode: "prepare-only" }),
    runErc8183ProviderJob: async (body: unknown) => ({ ok: true, result: {} }),
    submitDeliverableViaCircleCli: async (body: unknown) => ({ ok: true }),
    runGeneric: async (body: unknown) => ({ ok: true, result: {} }),
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

/**
 * Build a JSON-RPC body object (pre-parsed, as router would deliver).
 */
function makeRpcBody(method: string, params?: Record<string, unknown>, id = "test-1") {
  return { jsonrpc: "2.0" as const, id, method, params: params ?? {} };
}

describe("Runner MCP Server (router-authenticated)", () => {
  let services: any;
  let mcp: any;
  let config: RunnerConfig;
  let skill: { content: string; sha256: string; path: string };
  let ctx: any;

  beforeEach(() => {
    config = makeConfig();
    services = makeMockServices();
    mcp = makeMockMcp();
    skill = { content: "# Skill", sha256: "abc123", path: "/test/skill.md" };
    ctx = { services, mcp, config, skill };
  });

  async function callMcp(body: unknown, broker?: McpToolBroker | null): Promise<any> {
    const { res, output } = makeMockRes();
    await handleMcpRequest(res, body, ctx, broker);
    return JSON.parse(output().body);
  }

  // ── Auth is handled by router, not MCP handler ───────────────────────

  it("tools/list returns Runner-local tool names", async () => {
    const result = await callMcp(makeRpcBody("tools/list"));
    expect(result.result.tools).toBeDefined();
    const names = result.result.tools.map((t: any) => t.name);
    expect(names).toContain("runner.health");
    expect(names).toContain("runner.manifest");
    expect(names).toContain("x402.pay");
    expect(names).toContain("erc8183.provider_run_and_submit");
    expect(names).toContain("circle.status");
    expect(names).toContain("erc8004.prepare_register");
    expect(names).toContain("erc8183.create_job");
    expect(names).toContain("erc8183.set_budget");
    expect(names).toContain("erc8183.approve_usdc");
    expect(names).toContain("erc8183.fund_job");
    expect(names).toContain("erc8183.complete_job");
    expect(names).toContain("erc8183.reject_job");
    expect(names).toContain("erc8004.register_via_circle_cli");
    expect(names).toContain("circle.gateway_deposit");
  });

  it("tools/call runner.health works", async () => {
    const result = await callMcp(makeRpcBody("tools/call", { name: "runner.health", arguments: {} }));
    expect(result.result.ok).toBe(true);
    expect(result.result.runnerId).toBe("test-runner");
  });

  it("tools/call runner.manifest works", async () => {
    const result = await callMcp(makeRpcBody("tools/call", { name: "runner.manifest", arguments: {} }));
    expect(result.result.name).toBe("ArcLayer Runner");
  });

  it("tools/call x402.inspect does not require paymentEnabled", async () => {
    config.paymentEnabled = false;
    ctx.config = config;
    const result = await callMcp(makeRpcBody("tools/call", {
      name: "x402.inspect",
      arguments: { url: "https://api.example.com/test" }
    }));
    expect(result.result.ok).toBe(true);
  });

  it("tools/call x402.payment_policy returns policy", async () => {
    const result = await callMcp(makeRpcBody("tools/call", { name: "x402.payment_policy", arguments: {} }));
    expect(result.result.paymentEnabled).toBe(true);
    expect(result.result.perTxLimitUsdc).toBe("0.01");
  });

  it("tools/call circle.wallet_policy_status returns runnerPolicy", async () => {
    const result = await callMcp(makeRpcBody("tools/call", { name: "circle.wallet_policy_status", arguments: {} }));
    expect(result.result.runnerPolicy).toBeDefined();
    expect(result.result.runnerPolicy.perTxLimitUsdc).toBe("0.01");
    expect(result.result.walletAddress).toBe("0x0000000000000000000000000000000000000002");
    expect(result.result.warnings.length).toBeGreaterThan(0);
  });

  it("circle.wallet_policy_status handles missing wallet gracefully", async () => {
    config.circleWalletAddress = undefined;
    ctx.config = config;
    const result = await callMcp(makeRpcBody("tools/call", { name: "circle.wallet_policy_status", arguments: {} }));
    expect(result.result.ok).toBe(false);
    expect(result.result.runnerPolicy).toBeDefined();
    expect(result.result.warnings).toContain("CIRCLE_WALLET_ADDRESS not configured");
  });

  it("returns error for unknown tool", async () => {
    const result = await callMcp(makeRpcBody("tools/call", { name: "nonexistent.tool", arguments: {} }));
    const content = JSON.parse(result.result.content[0].text);
    expect(content.error).toContain("ROLE_TOOL_NOT_ALLOWED");
  });

  it("returns error for unknown method", async () => {
    const result = await callMcp(makeRpcBody("unknown/method"));
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain("Method not found");
  });

  it("returns error for invalid JSON-RPC", async () => {
    const result = await callMcp({ not: "jsonrpc" });
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32600);
  });

  it("returns error for missing tool name in tools/call", async () => {
    const result = await callMcp(makeRpcBody("tools/call", {}));
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602);
  });

  it("returns error for null body", async () => {
    const result = await callMcp(null);
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32600);
  });

  it("does NOT do internal Bearer auth (router owns auth)", async () => {
    const { res, output } = makeMockRes();
    const body = makeRpcBody("tools/list");
    await handleMcpRequest(res, body, ctx);
    const parsed = JSON.parse(output().body);
    expect(parsed.result.tools).toBeDefined();
    expect(parsed.error).toBeUndefined();
  });
});

describe("Runner MCP Server with Broker", () => {
  let services: any;
  let mcp: any;
  let config: RunnerConfig;
  let skill: { content: string; sha256: string; path: string };
  let ctx: any;
  let broker: McpToolBroker;

  beforeEach(() => {
    config = makeConfig();
    services = makeMockServices();
    mcp = makeMockMcp();
    skill = { content: "# Skill", sha256: "abc123", path: "/test/skill.md" };
    broker = new McpToolBroker({
      maxCalls: 3,
      maxTotalUsdc: "1.0",
      defaultTimeoutMs: 5000,
      maxOutputBytes: 1024,
    });
    ctx = { services, mcp, config, skill, broker };
  });

  async function callMcp(body: unknown): Promise<any> {
    const { res, output } = makeMockRes();
    await handleMcpRequest(res, body, ctx, broker);
    return JSON.parse(output().body);
  }

  it("broker introspection tools appear in tools/list", async () => {
    const result = await callMcp(makeRpcBody("tools/list"));
    const names = result.result.tools.map((t: any) => t.name);
    expect(names).toContain("runner.broker_status");
    expect(names).toContain("runner.audit_log");
  });

  it("runner.broker_status returns session state", async () => {
    const result = await callMcp(makeRpcBody("tools/call", { name: "runner.broker_status", arguments: {} }));
    expect(result.result.ok).toBe(true);
    expect(result.result.enabled).toBe(true);
    expect(result.result.callCount).toBe(0);
    expect(result.result.budgetLimits).toBeDefined();
  });

  it("runner.audit_log returns empty log initially", async () => {
    const result = await callMcp(makeRpcBody("tools/call", { name: "runner.audit_log", arguments: {} }));
    expect(result.result.ok).toBe(true);
    expect(result.result.total).toBe(0);
    expect(result.result.entries).toEqual([]);
  });

  it("broker tracks calls through audit log", async () => {
    // Make a tool call
    await callMcp(makeRpcBody("tools/call", { name: "runner.health", arguments: {} }));

    // Check audit log
    const result = await callMcp(makeRpcBody("tools/call", { name: "runner.audit_log", arguments: {} }));
    expect(result.result.total).toBe(1);
    expect(result.result.entries[0].toolName).toBe("runner.health");
    expect(result.result.entries[0].ok).toBe(true);
  });

  it("broker rejects when max calls exceeded", async () => {
    // Exhaust the budget (maxCalls = 3)
    await callMcp(makeRpcBody("tools/call", { name: "runner.health", arguments: {} }));
    await callMcp(makeRpcBody("tools/call", { name: "runner.health", arguments: {} }));
    await callMcp(makeRpcBody("tools/call", { name: "runner.health", arguments: {} }));

    // 4th call should fail
    const result = await callMcp(makeRpcBody("tools/call", { name: "runner.health", arguments: {} }));
    const content = JSON.parse(result.result.content[0].text);
    expect(content.ok).toBe(false);
    expect(content.error).toBe(BrokerErrorCode.MAX_CALLS_EXCEEDED);
  });

    it("broker rejects schema validation failures", async () => {
      // x402.pay requires maxAmountUsdc and reason
      // Use x402-agent role which has access to x402.pay
      config.allowedRoles = ["x402-agent", "provider"];
      ctx.config = config;
      const result = await callMcp(makeRpcBody("tools/call", {
        name: "x402.pay",
        arguments: { url: "https://api.example.com/test" }
      }));
      const content = JSON.parse(result.result.content[0].text);
      expect(content.ok).toBe(false);
      expect(content.error).toBe(BrokerErrorCode.SCHEMA_VALIDATION_FAILED);
    });

  it("broker allows valid tool calls through", async () => {
    const result = await callMcp(makeRpcBody("tools/call", {
      name: "x402.inspect",
      arguments: { url: "https://api.example.com/test" }
    }));
    expect(result.result.ok).toBe(true);
  });

  it("works without broker (backward compat)", async () => {
    const ctxNoBroker = { services, mcp, config, skill };
    const { res, output } = makeMockRes();
    await handleMcpRequest(res, makeRpcBody("tools/call", { name: "runner.health", arguments: {} }), ctxNoBroker);
    const result = JSON.parse(output().body);
    expect(result.result.ok).toBe(true);
  });
});

describe("Runner MCP tool catalog", () => {
  it("includes all required tool categories", () => {
    const names = RUNNER_MCP_TOOLS.map((t) => t.name);

    // Runner introspection
    expect(names).toContain("runner.health");
    expect(names).toContain("runner.manifest");
    expect(names).toContain("runner.skill");
    expect(names).toContain("runner.receipts");
    expect(names).toContain("runner.ledger");
    expect(names).toContain("runner.policy");

    // Broker introspection
    expect(names).toContain("runner.broker_status");
    expect(names).toContain("runner.audit_log");

    // Circle
    expect(names).toContain("circle.status");
    expect(names).toContain("circle.gateway_balance");
    expect(names).toContain("circle.wallet_balance");
    expect(names).toContain("circle.wallet_budget");
    expect(names).toContain("circle.wallet_policy_status");
    expect(names).toContain("circle.gateway_deposit");

    // x402
    expect(names).toContain("x402.inspect");
    expect(names).toContain("x402.pay");
    expect(names).toContain("x402.batch_pay");
    expect(names).toContain("x402.list_receipts");
    expect(names).toContain("x402.payment_policy");

    // ERC-8004
    expect(names).toContain("erc8004.prepare_register");
    expect(names).toContain("erc8004.register_via_circle_cli");

    // ERC-8183
    expect(names).toContain("erc8183.provider_run_job");
    expect(names).toContain("erc8183.provider_submit_deliverable");
    expect(names).toContain("erc8183.provider_run_and_submit");
    expect(names).toContain("erc8183.provider_runtime_status");
    expect(names).toContain("erc8183.create_job");
    expect(names).toContain("erc8183.set_budget");
    expect(names).toContain("erc8183.approve_usdc");
    expect(names).toContain("erc8183.fund_job");
    expect(names).toContain("erc8183.complete_job");
    expect(names).toContain("erc8183.reject_job");
  });
});

describe("Role-based tool filtering", () => {
  it("client role gets create_job, approve_usdc, fund_job", () => {
    const tools = getToolsForRole("client");
    const names = tools.map((t) => t.name);
    expect(names).toContain("erc8183.create_job");
    expect(names).toContain("erc8183.approve_usdc");
    expect(names).toContain("erc8183.fund_job");
  });

  it("provider role gets set_budget plus old provider tools", () => {
    const tools = getToolsForRole("provider");
    const names = tools.map((t) => t.name);
    expect(names).toContain("erc8183.set_budget");
    expect(names).toContain("erc8183.provider_run_job");
    expect(names).toContain("erc8183.provider_submit_deliverable");
    expect(names).toContain("erc8183.provider_run_and_submit");
  });

  it("evaluator role gets complete_job and reject_job", () => {
    const tools = getToolsForRole("evaluator");
    const names = tools.map((t) => t.name);
    expect(names).toContain("erc8183.complete_job");
    expect(names).toContain("erc8183.reject_job");
  });

  it("identity-agent gets register_via_circle_cli", () => {
    const tools = getToolsForRole("identity-agent");
    const names = tools.map((t) => t.name);
    expect(names).toContain("erc8004.register_via_circle_cli");
    expect(names).toContain("erc8004.prepare_register");
  });

  it("devops-admin gets gateway_deposit and all lifecycle tools", () => {
    const tools = getToolsForRole("devops-admin");
    const names = tools.map((t) => t.name);
    expect(names).toContain("circle.gateway_deposit");
    expect(names).toContain("erc8183.create_job");
    expect(names).toContain("erc8183.set_budget");
    expect(names).toContain("erc8183.approve_usdc");
    expect(names).toContain("erc8183.fund_job");
    expect(names).toContain("erc8183.complete_job");
    expect(names).toContain("erc8183.reject_job");
    expect(names).toContain("erc8004.register_via_circle_cli");
  });

  it("x402-agent does NOT get gateway_deposit", () => {
    const tools = getToolsForRole("x402-agent");
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("circle.gateway_deposit");
    expect(names).not.toContain("erc8183.create_job");
    expect(names).not.toContain("erc8004.register_via_circle_cli");
  });

  it("x402-agent does NOT get any lifecycle write tools", () => {
    const tools = getToolsForRole("x402-agent");
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("erc8183.create_job");
    expect(names).not.toContain("erc8183.set_budget");
    expect(names).not.toContain("erc8183.approve_usdc");
    expect(names).not.toContain("erc8183.fund_job");
    expect(names).not.toContain("erc8183.complete_job");
    expect(names).not.toContain("erc8183.reject_job");
  });

  it("all roles get broker introspection tools", () => {
    const roles = ["provider", "client", "evaluator", "x402-agent", "identity-agent", "devops-admin", "full-stack-agent"];
    for (const role of roles) {
      const tools = getToolsForRole(role);
      const names = tools.map((t) => t.name);
      expect(names).toContain("runner.broker_status");
      expect(names).toContain("runner.audit_log");
    }
  });
});
