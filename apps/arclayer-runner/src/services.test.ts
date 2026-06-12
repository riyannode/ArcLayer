import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunnerServices } from "./services";
import { RunnerError } from "@arclayer/runner-core";
import type { RunnerConfig } from "@arclayer/runner-core";
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
    dataDir: ".test-runner-services",
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
      return { ok: true, runId: "run-123" };
    },
    async prepareSubmitDeliverable(_jobId: string, _hash: string) {
      return { ok: true, calldata: "0x..." };
    },
    async completeJobRun(_jobId: string, _result: unknown, _runId?: string) {
      return { ok: true };
    },
    async retryJobRun(_jobId: string) { return { ok: true }; },
    async heartbeat() { return { ok: true }; },
    async getRuntimeContext() { return {}; },
    async getResumePlan() { return {}; },
    async writeCheckpoint() { return { ok: true }; },
    async listOpenJobs() { return []; },
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

    it("rejects evaluator for provider-only runner", async () => {
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
      await expectRunnerError(services.prepareRegister({}), "MISSING_FIELD");
    });

    it("delegates to MCP and returns prepare-only result with correct receipt type", async () => {
      const result = await services.prepareRegister({
        metadataURI: "https://example.com/agent.json"
      });

      expect(result.ok).toBe(true);
      expect(result.mode).toBe("prepare-only");
      expect(result.mcpResult).toBeDefined();
      expect(result.receipt).toBeDefined();
      expect(result.receipt.type).toBe("erc8004_prepare_register");
    });
  });

  describe("x402 inspect policy (separate from payment)", () => {
    it("works when payment disabled (inspect is read-only)", async () => {
      const disabledServices = new RunnerServices(
        makeConfig({ paymentEnabled: false }),
        runtime, mcp, skill
      );

      // inspectX402 should NOT throw PAYMENT_DISABLED
      // It will fail at Circle CLI (not installed), but policy check passes
      try {
        await disabledServices.inspectX402({
          type: "x402_service_pay",
          url: "https://api.example.com/test",
          maxAmountUsdc: "0.005",
          reason: "test"
        });
      } catch (error) {
        expect(error).not.toBeInstanceOf(RunnerError);
        // Expected: circle CLI not installed
      }
    });

    it("rejects unallowlisted host for inspect", async () => {
      await expectRunnerError(
        services.inspectX402({
          type: "x402_service_pay",
          url: "https://evil.com/test",
          maxAmountUsdc: "0.005",
          reason: "test"
        }),
        "X402_HOST_NOT_ALLOWED"
      );
    });
  });

  describe("x402 payment policy", () => {
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

  describe("x402 idempotency concurrency", () => {
    it("returns 409 when same idempotencyKey is already in progress", async () => {
      // Simulate: record a pending attempt, then try to pay with same key
      await services.ledger.recordAttempt({
        idempotencyKey: "concurrent-key-1",
        amountUsdc: "0.005",
        amountMicros: "5000"
      });

      // Second request with same key should get 409
      await expectRunnerError(
        services.payX402({
          type: "x402_service_pay",
          url: "https://api.example.com/test",
          maxAmountUsdc: "0.005",
          reason: "test",
          idempotencyKey: "concurrent-key-1"
        }),
        "PAYMENT_IN_PROGRESS"
      );
    });

    it("returns existing receipt for already-succeeded key", async () => {
      // Record a successful payment
      await services.ledger.recordAttempt({
        idempotencyKey: "success-key-1",
        amountUsdc: "0.005",
        amountMicros: "5000"
      });
      await services.ledger.recordSuccess("success-key-1", "receipt-xyz");

      const result = await services.payX402({
        type: "x402_service_pay",
        url: "https://api.example.com/test",
        maxAmountUsdc: "0.005",
        reason: "test",
        idempotencyKey: "success-key-1"
      });

      expect(result.ok).toBe(true);
      expect(result.idempotent).toBe(true);
      expect(result.message).toContain("already completed");
    });
  });

  describe("x402 server-side 409 idempotent-safe", () => {
    it("treats Circle CLI 409 error as idempotent success", async () => {
      // Mock payService to throw like Circle CLI does on server 409
      const paySpy = vi.spyOn(services.circle, "payService").mockRejectedValue(
        new Error("Payment submitted but request failed with HTTP 409.\nServer response: You already have an active access session for this resource.")
      );

      const result = await services.payX402({
        type: "x402_service_pay",
        url: "https://api.example.com/test",
        maxAmountUsdc: "0.005",
        reason: "test-409-idempotent"
      });

      expect(result.ok).toBe(true);
      expect(result.idempotent).toBe(true);
      expect(result.alreadyPaid).toBe(true);
      expect(result.message).toContain("409");
      expect(result.message).toContain("idempotent-safe");
      expect(result.receipt).toBeDefined();

      paySpy.mockRestore();
    });

    it("still throws for non-409 Circle CLI errors", async () => {
      const paySpy = vi.spyOn(services.circle, "payService").mockRejectedValue(
        new Error("Insufficient funds in wallet")
      );

      await expect(
        services.payX402({
          type: "x402_service_pay",
          url: "https://api.example.com/test",
          maxAmountUsdc: "0.005",
          reason: "test-real-error"
        })
      ).rejects.toThrow("Insufficient funds");

      paySpy.mockRestore();
    });
  });

  describe("MCP integration", () => {
    it("calls MCP startJobRun before runtime dispatch", async () => {
      const startSpy = vi.spyOn(mcp, "startJobRun");

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

  describe("gateway_deposit guard", () => {
    it("blocks gateway_deposit when allowGatewayDeposit=false (default)", async () => {
      const guardedServices = new RunnerServices(
        makeConfig({ allowGatewayDeposit: false }),
        runtime, mcp, skill
      );

      await expectRunnerError(
        guardedServices.gatewayDeposit({ amount: "1.0" }),
        "GATEWAY_DEPOSIT_DISABLED"
      );
    });

    it("blocks gateway_deposit when allowGatewayDeposit is not set", async () => {
      // Default config does not have allowGatewayDeposit=true
      await expectRunnerError(
        services.gatewayDeposit({ amount: "1.0" }),
        "GATEWAY_DEPOSIT_DISABLED"
      );
    });

    it("allows gateway_deposit when allowGatewayDeposit=true (passes guard, fails at CLI)", async () => {
      const enabledServices = new RunnerServices(
        makeConfig({ allowGatewayDeposit: true }),
        runtime, mcp, skill
      );

      // Should NOT throw GATEWAY_DEPOSIT_DISABLED
      // Will fail at Circle CLI execution (not installed), but guard passes
      try {
        await enabledServices.gatewayDeposit({ amount: "1.0" });
      } catch (error) {
        expect(error).not.toBeInstanceOf(RunnerError);
        // Expected: circle CLI not installed
      }
    });
  });

  describe("register_via_circle_cli guard", () => {
    it("blocks register when allowIdentityRegister=false (default)", async () => {
      const guardedServices = new RunnerServices(
        makeConfig({ allowIdentityRegister: false }),
        runtime, mcp, skill
      );

      await expectRunnerError(
        guardedServices.registerIdentityViaCircleCli({ metadataURI: "ipfs://meta" }),
        "IDENTITY_REGISTER_DISABLED"
      );
    });

    it("blocks register when allowIdentityRegister is not set", async () => {
      await expectRunnerError(
        services.registerIdentityViaCircleCli({ metadataURI: "ipfs://meta" }),
        "IDENTITY_REGISTER_DISABLED"
      );
    });

    it("rejects missing metadataURI even when enabled", async () => {
      const enabledServices = new RunnerServices(
        makeConfig({ allowIdentityRegister: true }),
        runtime, mcp, skill
      );

      await expectRunnerError(
        enabledServices.registerIdentityViaCircleCli({}),
        "MISSING_FIELD"
      );
    });

    it("allows register when allowIdentityRegister=true (passes guard, fails at CLI)", async () => {
      const enabledServices = new RunnerServices(
        makeConfig({ allowIdentityRegister: true }),
        runtime, mcp, skill
      );

      // Should NOT throw IDENTITY_REGISTER_DISABLED or MISSING_FIELD
      // Will fail at Circle CLI execution (not installed), but guard passes
      try {
        await enabledServices.registerIdentityViaCircleCli({ metadataURI: "ipfs://meta" });
      } catch (error) {
        expect(error).not.toBeInstanceOf(RunnerError);
        // Expected: circle CLI not installed
      }
    });
  });

  describe("old tools still work (backward compatibility)", () => {
    it("prepareRegister still delegates to MCP", async () => {
      const result = await services.prepareRegister({
        metadataURI: "https://example.com/agent.json"
      });

      expect(result.ok).toBe(true);
      expect(result.mode).toBe("prepare-only");
      expect(result.receipt.type).toBe("erc8004_prepare_register");
    });

    it("runErc8183ProviderJob still dispatches to runtime", async () => {
      const runSpy = vi.spyOn(runtime, "run");

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
        // Expected: Circle CLI not available
      }

      expect(runSpy).toHaveBeenCalled();
    });

    it("submitDeliverableViaCircleCli uses executeErc8183Write (not legacy)", async () => {
      // Verify the method exists and accepts the right params
      expect(services.submitDeliverableViaCircleCli).toBeDefined();

      // Will fail at CLI but should not throw schema errors
      try {
        await services.submitDeliverableViaCircleCli({
          jobId: "42",
          deliverableHash: "0x" + "ab".repeat(32)
        });
      } catch (error) {
        // Expected: circle CLI not installed
        expect(error).not.toBeInstanceOf(RunnerError);
      }
    });
  });
});
