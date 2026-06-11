import { describe, it, expect, beforeEach } from "vitest";
import { handleMcpRequest } from "./mcp-server";
import { RUNNER_MCP_TOOLS } from "./mcp-schemas";
import type { RunnerConfig } from "@arclayer/runner-core";
import type { RunnerServices } from "./services";
import type { ArcLayerMcpConnector } from "./mcp-connector";
import type { IncomingMessage, ServerResponse } from "node:http";

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
    dataDir: ".test-mcp",
    port: 8787,
    runnerSecret: "test-secret-at-least-16-chars",
    ...overrides
  };
}

function makeMockReq(body?: string, auth?: string): IncomingMessage {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  const chunks = body ? [Buffer.from(body)] : [];
  let i = 0;
  return {
    headers,
    method: "POST",
    url: "/mcp",
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    }
  } as unknown as IncomingMessage;
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

describe("Runner MCP Server", () => {
  const secret = "test-secret-at-least-16-chars";
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

  async function callMcp(method: string, params?: any, auth?: string): Promise<any> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: "test-1",
      method,
      params: params ?? {}
    });
    const req = makeMockReq(body, auth ?? `Bearer ${secret}`);
    const { res, output } = makeMockRes();
    await handleMcpRequest(req, res, secret, ctx);
    return JSON.parse(output().body);
  }

  it("rejects missing auth", async () => {
    const req = makeMockReq(JSON.stringify({
      jsonrpc: "2.0", id: "1", method: "tools/list", params: {}
    }));
    const { res, output } = makeMockRes();

    await handleMcpRequest(req, res, secret, ctx);
    const parsed = JSON.parse(output().body);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.message).toContain("Missing Authorization");
  });

  it("rejects wrong bearer token", async () => {
    const result = await callMcp("tools/list", {}, "Bearer wrong-token");
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain("Invalid runner secret");
  });

  it("tools/list returns Runner-local tool names", async () => {
    const result = await callMcp("tools/list");
    expect(result.result.tools).toBeDefined();
    const names = result.result.tools.map((t: any) => t.name);
    expect(names).toContain("runner.health");
    expect(names).toContain("runner.manifest");
    expect(names).toContain("x402.pay");
    expect(names).toContain("erc8183.provider_run_and_submit");
    expect(names).toContain("circle.status");
    expect(names).toContain("erc8004.prepare_register");
  });

  it("tools/call runner.health works", async () => {
    const result = await callMcp("tools/call", { name: "runner.health", arguments: {} });
    expect(result.result.ok).toBe(true);
    expect(result.result.runnerId).toBe("test-runner");
  });

  it("tools/call runner.manifest works", async () => {
    const result = await callMcp("tools/call", { name: "runner.manifest", arguments: {} });
    expect(result.result.name).toBe("ArcLayer Runner");
  });

  it("tools/call x402.inspect does not require paymentEnabled", async () => {
    config.paymentEnabled = false;
    ctx.config = config;
    const result = await callMcp("tools/call", {
      name: "x402.inspect",
      arguments: { url: "https://api.example.com/test" }
    });
    expect(result.result.ok).toBe(true);
  });

  it("tools/call x402.payment_policy returns policy", async () => {
    const result = await callMcp("tools/call", { name: "x402.payment_policy", arguments: {} });
    expect(result.result.paymentEnabled).toBe(true);
    expect(result.result.perTxLimitUsdc).toBe("0.01");
  });

  it("returns error for unknown tool", async () => {
    const result = await callMcp("tools/call", { name: "nonexistent.tool", arguments: {} });
    expect(result.result.error).toContain("Unknown tool");
  });

  it("returns error for unknown method", async () => {
    const result = await callMcp("unknown/method");
    expect(result.error).toBeDefined();
    expect(result.error.message).toContain("Method not found");
  });

  it("returns error for invalid JSON-RPC", async () => {
    const req = makeMockReq(JSON.stringify({ not: "jsonrpc" }), `Bearer ${secret}`);
    const { res, output } = makeMockRes();
    await handleMcpRequest(req, res, secret, ctx);
    const parsed = JSON.parse(output().body);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe(-32600);
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

    // Circle
    expect(names).toContain("circle.status");
    expect(names).toContain("circle.gateway_balance");
    expect(names).toContain("circle.wallet_balance");
    expect(names).toContain("circle.wallet_budget");

    // x402
    expect(names).toContain("x402.inspect");
    expect(names).toContain("x402.pay");
    expect(names).toContain("x402.batch_pay");
    expect(names).toContain("x402.list_receipts");
    expect(names).toContain("x402.payment_policy");

    // ERC-8004
    expect(names).toContain("erc8004.prepare_register");

    // ERC-8183
    expect(names).toContain("erc8183.provider_run_job");
    expect(names).toContain("erc8183.provider_submit_deliverable");
    expect(names).toContain("erc8183.provider_run_and_submit");
    expect(names).toContain("erc8183.provider_runtime_status");
  });
});
