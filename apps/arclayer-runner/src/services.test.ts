import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunnerServices } from "./services";
import { RunnerError } from "@arclayer/runner-core";
import type { RunnerConfig, RuntimeResult } from "@arclayer/runner-core";
import type { RuntimeConnector } from "./runtime";
import type { ArcLayerMcpConnector } from "./mcp-connector";

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
    dataDir: ".test-runner",
    port: 8787,
    runnerSecret: "test-secret-at-least-16-chars",
    ...overrides
  };
}

function makeMockRuntime(): RuntimeConnector {
  return {
    kind: "mock",
    async run(_task) {
      return {
        ok: true,
        status: "completed",
        output: { result: "mock-output" },
        artifacts: [],
        paymentRequests: [],
        actionRequests: []
      };
    }
  };
}

function makeMockMcp(): ArcLayerMcpConnector {
  return {
    async prepareRegisterAgent(_uri: string) {
      return { ok: true, calldata: "0x..." };
    },
    async startJobRun(_jobId: string) {
      return { ok: true };
    },
    async prepareSubmitDeliverable(_jobId: string, _hash: string) {
      return { ok: true, calldata: "0x..." };
    },
    async completeJobRun(_jobId: string, _result: unknown) {
      return { ok: true };
    },
    async heartbeat() { return { ok: true }; },
    async getRuntimeContext() { return {}; },
    async getResumePlan() { return {}; },
    async writeCheckpoint() { return { ok: true }; },
    async failJobRun() { return { ok: true }; },
    async listOpenGlobalJobs() { return []; },
    async listAssignedJobs() { return []; },
    async applyToOpenJob() { return { ok: true }; },
    async listPublicJobs() { return []; },
    async getPublicJob() { return {}; },
    async prepareCompleteJob() { return { ok: true }; },
    async giveFeedback() { return { ok: true }; },
    async callTool() { return {}; }
  } as unknown as ArcLayerMcpConnector;
}

function expectRunnerError(promise: Promise<unknown>, code: string) {
  return promise.then(
    () => expect.fail(`Expected RunnerError with code ${code}`),
    (error) => {
      expect(error).toBeInstanceOf(RunnerError);
      expect((error as RunnerError).code).toBe(code);
    }
  );
}

describe("RunnerServices", () => {
  let config: RunnerConfig;
  let runtime: RuntimeConnector;
  let mcp: ArcLayerMcpConnector;
  let skill: { content: string; sha256: string; path: string };
  let services: RunnerServices;

  beforeEach(() => {
    config = makeConfig();
    runtime = makeMockRuntime();
    mcp = makeMockMcp();
    skill = { content: "# Skill", sha256: "abc123", path: "/test/skill.md" };
    services = new RunnerServices(config, runtime, mcp, skill);
  });

  describe("manifest", () => {
    it("returns runner capabilities including mcp_bridge", () => {
      const manifest = services.manifest();
      expect(manifest.capabilities).toContain("mcp_bridge");
      expect(manifest.capabilities).toContain("auth_gated");
      expect(manifest.capabilities).toContain("spending_ledger");
      expect(manifest.runnerId).toBe("test-runner");
    });
  });

  describe("runGeneric", () => {
    it("rejects wrong agentId", async () => {
      await expectRunnerError(
        services.runGeneric({
          taskId: "t1",
          protocol: "generic",
          role: "provider",
          agentId: "wrong-agent",
          input: {}
        }),
        "AGENT_ID_MISMATCH"
      );
    });

    it("rejects evaluator for provider-only runner (ROLE_NOT_ALLOWED fires first)", async () => {
      await expectRunnerError(
        services.runGeneric({
          taskId: "t1",
          protocol: "generic",
          role: "evaluator",
          agentId: "agent-1",
          input: {}
        }),
        "ROLE_NOT_ALLOWED"
      );
    });

    it("succeeds for valid provider task", async () => {
      const result = await services.runGeneric({
        taskId: "t1",
        protocol: "generic",
        role: "provider",
        agentId: "agent-1",
        input: { prompt: "do work" }
      });

      expect(result.ok).toBe(true);
      expect(result.result.ok).toBe(true);
      expect(result.receipt).toBeDefined();
    });
  });

  describe("prepareRegister", () => {
    it("rejects missing metadataURI", async () => {
      await expectRunnerError(
        services.prepareRegister({}),
        "MISSING_FIELD"
      );
    });

    it("delegates to MCP and returns prepare-only result", async () => {
      const result = await services.prepareRegister({
        metadataURI: "https://example.com/agent.json"
      });

      expect(result.ok).toBe(true);
      expect(result.mode).toBe("prepare-only");
      expect(result.mcpResult).toBeDefined();
      expect(result.receipt).toBeDefined();
    });
  });

  describe("x402 policy", () => {
    it("rejects payment when disabled", async () => {
      const disabledServices = new RunnerServices(
        makeConfig({ paymentEnabled: false }),
        runtime, mcp, skill
      );

      await expectRunnerError(
        disabledServices.payX402({
          type: "x402_service_pay",
          url: "https://api.example.com/test",
          maxAmountUsdc: "0.005",
          reason: "test"
        }),
        "PAYMENT_DISABLED"
      );
    });

    it("rejects unallowlisted host", async () => {
      await expectRunnerError(
        services.payX402({
          type: "x402_service_pay",
          url: "https://evil.com/test",
          maxAmountUsdc: "0.005",
          reason: "test"
        }),
        "X402_HOST_NOT_ALLOWED"
      );
    });

    it("rejects amount exceeding per-tx limit", async () => {
      await expectRunnerError(
        services.payX402({
          type: "x402_service_pay",
          url: "https://api.example.com/test",
          maxAmountUsdc: "1.0",
          reason: "test"
        }),
        "PER_TX_LIMIT_EXCEEDED"
      );
    });
  });

  describe("MCP integration", () => {
    it("calls MCP startJobRun before runtime dispatch", async () => {
      const startSpy = vi.spyOn(mcp, "startJobRun");

      // Will fail at Circle CLI (not installed), but MCP calls should happen
      try {
        await services.runErc8183ProviderJob({
          taskId: "t1",
          jobId: "42",
          agentId: "agent-1",
          provider: "0x0000000000000000000000000000000000000001",
          description: "test job",
          input: { prompt: "do work" }
        });
      } catch {
        // Expected: Circle CLI not available in test env
      }

      expect(startSpy).toHaveBeenCalledWith("42");
    });
  });
});
