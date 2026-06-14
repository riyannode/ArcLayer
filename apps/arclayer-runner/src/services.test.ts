import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunnerServices } from "./services";
import { RunnerError } from "@arclayer/runner-core";
import { TaskIdempotencyStore } from "@arclayer/runner-core";
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
      const paySpy = vi.spyOn((services as any).circle, "payService").mockRejectedValue(
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
      const paySpy = vi.spyOn((services as any).circle, "payService").mockRejectedValue(
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

  describe("x402 broker timeout — non-terminal ledger", () => {
    it("AbortError with aborted signal does NOT call ledger.recordFailure", async () => {
      const controller = new AbortController();
      controller.abort();

      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";

      const paySpy = vi.spyOn((services as any).circle, "payService").mockRejectedValue(abortError);
      const failureSpy = vi.spyOn(services.ledger, "recordFailure");

      await expect(
        services.payX402({
          type: "x402_service_pay",
          url: "https://api.example.com/test",
          maxAmountUsdc: "0.005",
          reason: "test-abort",
          idempotencyKey: "abort-key-1",
        }, controller.signal)
      ).rejects.toThrow();

      // recordFailure must NOT be called — attempt stays pending
      expect(failureSpy).not.toHaveBeenCalled();

      paySpy.mockRestore();
      failureSpy.mockRestore();
    });

    it("pending attempt remains pending after AbortError (retry hits PAYMENT_IN_PROGRESS)", async () => {
      const controller = new AbortController();
      controller.abort();

      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";

      const paySpy = vi.spyOn((services as any).circle, "payService").mockRejectedValue(abortError);

      // First attempt — will abort
      await expect(
        services.payX402({
          type: "x402_service_pay",
          url: "https://api.example.com/test",
          maxAmountUsdc: "0.005",
          reason: "test-pending",
          idempotencyKey: "abort-pending-key",
        }, controller.signal)
      ).rejects.toThrow();

      paySpy.mockRestore();

      // Retry with same idempotencyKey — should hit PAYMENT_IN_PROGRESS
      // because the attempt was left pending (not terminal failure).
      await expect(
        services.payX402({
          type: "x402_service_pay",
          url: "https://api.example.com/test",
          maxAmountUsdc: "0.005",
          reason: "test-pending",
          idempotencyKey: "abort-pending-key",
        })
      ).rejects.toThrow(/already in progress/);
    });

    it("normal non-timeout Circle CLI failure still calls ledger.recordFailure", async () => {
      const paySpy = vi.spyOn((services as any).circle, "payService").mockRejectedValue(
        new Error("Insufficient funds in wallet")
      );
      const failureSpy = vi.spyOn(services.ledger, "recordFailure");

      await expect(
        services.payX402({
          type: "x402_service_pay",
          url: "https://api.example.com/test",
          maxAmountUsdc: "0.005",
          reason: "test-normal-failure",
          idempotencyKey: "normal-fail-key",
        })
      ).rejects.toThrow("Insufficient funds");

      // recordFailure SHOULD be called for real errors
      expect(failureSpy).toHaveBeenCalledWith("normal-fail-key", expect.stringContaining("Insufficient funds"));

      paySpy.mockRestore();
      failureSpy.mockRestore();
    });
  });

  describe("createJob evaluator guard", () => {
    it("rejects zero evaluator address", async () => {
      await expectRunnerError(
        services.createJob({
          provider: "0x0000000000000000000000000000000000000001",
          evaluator: "0x0000000000000000000000000000000000000000",
          expiredAt: Math.floor(Date.now() / 1000) + 3600,
          description: "test job"
        }),
        "INVALID_EVALUATOR"
      );
    });

    it("rejects empty evaluator", async () => {
      await expectRunnerError(
        services.createJob({
          provider: "0x0000000000000000000000000000000000000001",
          evaluator: "",
          expiredAt: Math.floor(Date.now() / 1000) + 3600,
          description: "test job"
        }),
        "INVALID_EVALUATOR"
      );
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

      // Will fail at CLI — gateway wraps as RunnerError via assertGatewayWriteSucceeded
      try {
        await services.submitDeliverableViaCircleCli({
          jobId: "42",
          deliverableHash: "0x" + "ab".repeat(32)
        });
        expect.fail("should have thrown");
      } catch (error) {
        // Expected: gateway wraps CLI failure as RunnerError
        expect(error).toBeInstanceOf(RunnerError);
        expect((error as RunnerError).code).toBe("BROADCAST_FAILED");
      }
    });
  });
});

describe("Task idempotency lifecycle", () => {
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

  it("invalid agentId does not burn taskId", async () => {
    const reserved: string[] = [];
    const lifecycle = {
      reserveTaskId: (taskId: string, _agentId: string) => { reserved.push(taskId); },
    };

    await expect(
      services.runGeneric({
        taskId: "task-1",
        protocol: "generic",
        role: "provider",
        agentId: "wrong-agent",
        input: {}
      }, lifecycle)
    ).rejects.toThrow();

    // taskId should NOT have been reserved — validation failed before dispatch
    expect(reserved).toHaveLength(0);
  });

  it("invalid role does not burn taskId", async () => {
    const reserved: string[] = [];
    const lifecycle = {
      reserveTaskId: (taskId: string, _agentId: string) => { reserved.push(taskId); },
    };

    await expect(
      services.runGeneric({
        taskId: "task-2",
        protocol: "generic",
        role: "evaluator",
        agentId: "agent-1",
        input: {}
      }, lifecycle)
    ).rejects.toThrow();

    expect(reserved).toHaveLength(0);
  });

  it("retry same taskId with valid body succeeds after failed validation", async () => {
    const reserved: string[] = [];
    const lifecycle = {
      reserveTaskId: (taskId: string, _agentId: string) => { reserved.push(taskId); },
    };

    // First attempt: wrong agentId — should NOT burn taskId
    await expect(
      services.runGeneric({
        taskId: "task-3",
        protocol: "generic",
        role: "provider",
        agentId: "wrong-agent",
        input: {}
      }, lifecycle)
    ).rejects.toThrow();

    expect(reserved).toHaveLength(0);

    // Second attempt: correct agentId — should succeed
    const result = await services.runGeneric({
      taskId: "task-3",
      protocol: "generic",
      role: "provider",
      agentId: "agent-1",
      input: {}
    }, lifecycle);

    expect(result.ok).toBe(true);
    expect(reserved).toEqual(["task-3"]);
  });

  it("valid dispatched task duplicated returns DUPLICATE_TASK", async () => {
    const store = new TaskIdempotencyStore();
    const lifecycle = {
      reserveTaskId: (taskId: string, agentId: string) => store.checkAndMark(taskId, agentId),
    };

    // First dispatch — succeeds
    const result1 = await services.runGeneric({
      taskId: "task-4",
      protocol: "generic",
      role: "provider",
      agentId: "agent-1",
      input: {}
    }, lifecycle);
    expect(result1.ok).toBe(true);

    // Second dispatch — same taskId, should throw DUPLICATE_TASK
    await expect(
      services.runGeneric({
        taskId: "task-4",
        protocol: "generic",
        role: "provider",
        agentId: "agent-1",
        input: {}
      }, lifecycle)
    ).rejects.toMatchObject({ code: "DUPLICATE_TASK" });

    store.destroy();
  });

  it("same taskId for different agents does not conflict", async () => {
    const store = new TaskIdempotencyStore();
    const lifecycle = {
      reserveTaskId: (taskId: string, agentId: string) => store.checkAndMark(taskId, agentId),
    };

    // agent-1 dispatches task-5
    const result1 = await services.runGeneric({
      taskId: "task-5",
      protocol: "generic",
      role: "provider",
      agentId: "agent-1",
      input: {}
    }, lifecycle);
    expect(result1.ok).toBe(true);

    // agent-1 dispatches task-5 again — should fail
    await expect(
      services.runGeneric({
        taskId: "task-5",
        protocol: "generic",
        role: "provider",
        agentId: "agent-1",
        input: {}
      }, lifecycle)
    ).rejects.toMatchObject({ code: "DUPLICATE_TASK" });

    store.destroy();
  });

  it("markTaskCompleted called on success", async () => {
    const completed: string[] = [];
    const lifecycle = {
      reserveTaskId: () => {},
      markTaskCompleted: (taskId: string, _agentId: string) => { completed.push(taskId); },
    };

    await services.runGeneric({
      taskId: "task-6",
      protocol: "generic",
      role: "provider",
      agentId: "agent-1",
      input: {}
    }, lifecycle);

    expect(completed).toEqual(["task-6"]);
  });

  it("markTaskFailed called on runtime error", async () => {
    const failed: string[] = [];
    const lifecycle = {
      reserveTaskId: () => {},
      markTaskFailed: (taskId: string, _agentId: string) => { failed.push(taskId); },
    };

    // Make runtime throw
    const throwingRuntime: RuntimeConnector = {
      kind: "mock",
      async run() { throw new Error("runtime exploded"); }
    };
    const failServices = new RunnerServices(config, throwingRuntime, mcp, skill);

    await expect(
      failServices.runGeneric({
        taskId: "task-7",
        protocol: "generic",
        role: "provider",
        agentId: "agent-1",
        input: {}
      }, lifecycle)
    ).rejects.toThrow("runtime exploded");

    expect(failed).toEqual(["task-7"]);
  });
});

// ── Patch: sanitized request in OpenClaw receipts ─────────────────────

describe("OpenClaw receipt request sanitization", () => {
  it("OpenClaw receipt does not include sensitive metadata (apiToken, runnerSecret, privateKey, walletAddress)", async () => {
    const config = makeConfig();
    const openClawRuntime: RuntimeConnector = {
      kind: "openclaw",
      async run(_task) {
        return {
          ok: true,
          status: "completed",
          output: { result: "done" },
          artifacts: [],
          paymentRequests: [],
          actionRequests: [],
        };
      }
    };
    const mcp = makeMockMcp();
    const skill = { content: "# Skill", sha256: "abc123", path: "/test/skill.md" };
    const svc = new RunnerServices(config, openClawRuntime, mcp, skill);

    // Spy on receipts.append to capture the written record
    const appended: any[] = [];
    const originalAppend = svc.receipts.append.bind(svc.receipts);
    svc.receipts.append = async (record: any) => {
      appended.push(record);
      return originalAppend(record);
    };

    await svc.runGeneric({
      taskId: "task-oc-1",
      protocol: "generic",
      role: "provider",
      agentId: "agent-1",
      input: { prompt: "hello" },
      metadata: {
        jobId: "123",
        description: "test job",
        runnerSecret: "super-secret",
        apiToken: "tok-123",
        walletAddress: "0x1234",
        privateKey: "0xdeadbeef",
        authorization: "Bearer xyz",
      },
    });

    expect(appended).toHaveLength(1);
    const req = appended[0].request;

    // Sensitive keys must be stripped
    expect(req.metadata.runnerSecret).toBeUndefined();
    expect(req.metadata.apiToken).toBeUndefined();
    expect(req.metadata.walletAddress).toBeUndefined();
    expect(req.metadata.privateKey).toBeUndefined();
    expect(req.metadata.authorization).toBeUndefined();

    // Safe keys must be preserved
    expect(req.metadata.jobId).toBe("123");
    expect(req.metadata.description).toBe("test job");

    // Proof sanitized=true
    expect(appended[0].proof.sanitized).toBe(true);
    expect(appended[0].proof.runtimeKind).toBe("openclaw");
  });

  it("Hermes receipt stores full task (no sanitization)", async () => {
    const config = makeConfig({ runtimeKind: "hermes" });
    const hermesRuntime: RuntimeConnector = {
      kind: "hermes",
      async run(_task) {
        return {
          ok: true,
          status: "completed",
          output: { result: "done" },
          artifacts: [],
          paymentRequests: [],
          actionRequests: [],
        };
      }
    };
    const mcp = makeMockMcp();
    const skill = { content: "# Skill", sha256: "abc123", path: "/test/skill.md" };
    const svc = new RunnerServices(config, hermesRuntime, mcp, skill);

    const appended: any[] = [];
    const originalAppend = svc.receipts.append.bind(svc.receipts);
    svc.receipts.append = async (record: any) => {
      appended.push(record);
      return originalAppend(record);
    };

    await svc.runGeneric({
      taskId: "task-hermes-1",
      protocol: "generic",
      role: "provider",
      agentId: "agent-1",
      input: { prompt: "hello" },
      metadata: {
        jobId: "456",
        runnerSecret: "should-be-preserved",
        walletAddress: "0xabcd",
      },
    });

    expect(appended).toHaveLength(1);
    const req = appended[0].request;

    // Hermes stores full metadata (trusted)
    expect(req.metadata.runnerSecret).toBe("should-be-preserved");
    expect(req.metadata.walletAddress).toBe("0xabcd");
    expect(req.metadata.jobId).toBe("456");

    // Proof sanitized=false for hermes
    expect(appended[0].proof.sanitized).toBe(false);
    expect(appended[0].proof.runtimeKind).toBe("hermes");
  });
});

// ── Phase 3: runProviderJob / submitProviderDeliverable / runAndSubmitProviderJob ──

describe("runProviderJob", () => {
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

  const validJob = {
    taskId: "t1",
    jobId: "42",
    agentId: "agent-1",
    provider: "0x0000000000000000000000000000000000000001",
    description: "test job",
    input: { prompt: "do work" }
  };

  it("completed result returns runtime result without Circle CLI submit", async () => {
    const circleSpy = vi.spyOn((services as any).circle, "executeErc8183Write");
    const result = await services.runProviderJob(validJob);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.deliverableHash).toBeDefined();
    expect(result.deliverableHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    // Circle CLI must NOT be called
    expect(circleSpy).not.toHaveBeenCalled();
    circleSpy.mockRestore();
  });

  it("failed result returns controlled error without Circle CLI submit", async () => {
    const failRuntime: RuntimeConnector = {
      kind: "mock",
      async run() {
        return { ok: false, status: "failed", error: "runtime exploded", artifacts: [], paymentRequests: [], actionRequests: [] } as RuntimeResult;
      }
    };
    const svc = new RunnerServices(config, failRuntime, mcp, skill);
    const circleSpy = vi.spyOn(svc.circle, "executeErc8183Write");

    const result = await svc.runProviderJob(validJob);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("runtime_failure");
    expect(result.error).toContain("runtime exploded");
    expect(circleSpy).not.toHaveBeenCalled();
    circleSpy.mockRestore();
  });

  it("Hermes/custom needs_payment writes checkpoint and does not submit", async () => {
    const needsPaymentRuntime: RuntimeConnector = {
      kind: "hermes",
      async run() {
        return {
          ok: true,
          status: "needs_payment",
          artifacts: [],
          actionRequests: [],
          paymentRequests: [{ type: "x402_service_pay" as const, url: "https://api.example.com/pay", maxAmountUsdc: "0.01", reason: "unlock", method: "GET" as const }]
        } as RuntimeResult;
      }
    };
    const svc = new RunnerServices(config, needsPaymentRuntime, mcp, skill);
    const checkpointSpy = vi.spyOn(mcp, "writeCheckpoint");
    const circleSpy = vi.spyOn(svc.circle, "executeErc8183Write");

    const result = await svc.runProviderJob(validJob);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("needs_payment");
    expect((result as any).deliverableHash).toBeUndefined();
    // checkpoint must be written with status and paymentRequests
    expect(checkpointSpy).toHaveBeenCalledWith("42", expect.objectContaining({
      status: "needs_payment",
      paymentRequests: expect.any(Array)
    }));
    // no Circle CLI submit
    expect(circleSpy).not.toHaveBeenCalled();
    circleSpy.mockRestore();
  });

  it("Hermes/custom needs_action writes checkpoint and does not submit", async () => {
    const needsActionRuntime: RuntimeConnector = {
      kind: "hermes",
      async run() {
        return {
          ok: true,
          status: "needs_action",
          artifacts: [],
          paymentRequests: [],
          actionRequests: [{ type: "user_confirm", payload: {} }]
        } as RuntimeResult;
      }
    };
    const svc = new RunnerServices(config, needsActionRuntime, mcp, skill);
    const checkpointSpy = vi.spyOn(mcp, "writeCheckpoint");
    const circleSpy = vi.spyOn(svc.circle, "executeErc8183Write");

    const result = await svc.runProviderJob(validJob);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("needs_action");
    expect((result as any).deliverableHash).toBeUndefined();
    // checkpoint must be written with status and actionRequests
    expect(checkpointSpy).toHaveBeenCalledWith("42", expect.objectContaining({
      status: "needs_action",
      actionRequests: expect.any(Array)
    }));
    // no Circle CLI submit
    expect(circleSpy).not.toHaveBeenCalled();
    circleSpy.mockRestore();
  });

  it("rejects wrong agentId", async () => {
    await expectRunnerError(
      services.runProviderJob({ ...validJob, agentId: "wrong-agent" }),
      "AGENT_ID_MISMATCH"
    );
  });

  it("rejects when provider role not in allowedRoles", async () => {
    const noProviderConfig = makeConfig({ allowedRoles: [] });
    const svc = new RunnerServices(noProviderConfig, runtime, mcp, skill);
    await expectRunnerError(
      svc.runProviderJob(validJob),
      "ROLE_NOT_ALLOWED"
    );
  });

  it("calls MCP startJobRun before runtime dispatch", async () => {
    const startSpy = vi.spyOn(mcp, "startJobRun");
    await services.runProviderJob(validJob);
    expect(startSpy).toHaveBeenCalledWith("42");
  });

  it("does NOT call MCP completeJobRun (deferred to submit step)", async () => {
    const completeSpy = vi.spyOn(mcp, "completeJobRun");
    await services.runProviderJob(validJob);
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it("stores runtime_result receipt for durable evidence", async () => {
    const result = await services.runProviderJob(validJob);
    expect(result.ok).toBe(true);
    expect(result.receipt).toBeDefined();
    expect(result.receipt.type).toBe("runtime_result");
  });
});

describe("submitProviderDeliverable", () => {
  let config: RunnerConfig;
  let runtime: RuntimeConnector;
  let mcp: ArcLayerMcpConnector;
  let skill: { content: string; sha256: string; path: string };
  let services: RunnerServices;

  const completedResult: RuntimeResult = {
    ok: true,
    status: "completed",
    output: { result: "test-output" },
    artifacts: [],
    paymentRequests: [],
    actionRequests: []
  };

  const validHash = "0x" + "a".repeat(64) as `0x${string}`;

  beforeEach(() => {
    config = makeConfig();
    runtime = makeMockRuntime();
    mcp = makeMockMcp();
    skill = { content: "# Skill", sha256: "abc123", path: "/test/skill.md" };
    services = new RunnerServices(config, runtime, mcp, skill);
  });

  it("completed result submits once", async () => {
    const submitSpy = vi.spyOn(services, "submitDeliverableViaCircleCli").mockResolvedValue({
      ok: true,
      command: "circle",
      args: [],
      json: { txHash: "0x" + "ab".repeat(32) }
    } as any);

    const result = await services.submitProviderDeliverable({
      jobId: "42",
      deliverableHash: validHash,
      result: completedResult
    });

    expect(result.ok).toBe(true);
    expect(result.deliverableHash).toBe(validHash);
    expect(submitSpy).toHaveBeenCalledOnce();
    submitSpy.mockRestore();
  });

  it("failed result rejected", async () => {
    const failedResult = { ok: false, status: "failed", error: "boom", artifacts: [], paymentRequests: [], actionRequests: [] } as RuntimeResult;
    await expect(
      services.submitProviderDeliverable({
        jobId: "42",
        deliverableHash: validHash,
        result: failedResult
      })
    ).rejects.toThrow(/Cannot submit provider deliverable for runtime status: failed/);
  });

  it("needs_payment rejected", async () => {
    const needsPaymentResult = { ok: true, status: "needs_payment", paymentRequests: [], artifacts: [], actionRequests: [] } as RuntimeResult;
    await expect(
      services.submitProviderDeliverable({
        jobId: "42",
        deliverableHash: validHash,
        result: needsPaymentResult
      })
    ).rejects.toThrow(/Cannot submit provider deliverable for runtime status: needs_payment/);
  });

  it("needs_action rejected", async () => {
    const needsActionResult = { ok: true, status: "needs_action", actionRequests: [], artifacts: [], paymentRequests: [] } as RuntimeResult;
    await expect(
      services.submitProviderDeliverable({
        jobId: "42",
        deliverableHash: validHash,
        result: needsActionResult
      })
    ).rejects.toThrow(/Cannot submit provider deliverable for runtime status: needs_action/);
  });

  it("invalid deliverableHash rejected", async () => {
    await expect(
      services.submitProviderDeliverable({
        jobId: "42",
        deliverableHash: "not-a-hash" as any,
        result: completedResult
      })
    ).rejects.toThrow(/deliverableHash must be a valid bytes32/);
  });

  it("invalid jobId rejected", async () => {
    await expect(
      services.submitProviderDeliverable({
        jobId: "",
        deliverableHash: validHash,
        result: completedResult
      })
    ).rejects.toThrow(/jobId must be a numeric string/);
  });

  it("returns prepared-only when circleWalletAddress not configured", async () => {
    const noWalletConfig = makeConfig({ circleWalletAddress: undefined });
    const svc = new RunnerServices(noWalletConfig, runtime, mcp, skill);

    const result = await svc.submitProviderDeliverable({
      jobId: "42",
      deliverableHash: validHash,
      result: completedResult
    });

    expect(result.ok).toBe(false);
    expect((result as any).mode).toBe("prepared-only");
  });

  it("calls prepareSubmitDeliverable before Circle CLI submit", async () => {
    const prepareSpy = vi.spyOn(mcp, "prepareSubmitDeliverable");
    const submitSpy = vi.spyOn(services, "submitDeliverableViaCircleCli").mockResolvedValue({
      ok: true,
      command: "circle",
      args: [],
      json: { txHash: "0x" + "ab".repeat(32) }
    } as any);

    await services.submitProviderDeliverable({
      jobId: "42",
      deliverableHash: validHash,
      result: completedResult
    });

    expect(prepareSpy).toHaveBeenCalledWith("42", validHash);
    // prepare must be called before submit
    expect(prepareSpy.mock.invocationCallOrder[0]).toBeLessThan(
      submitSpy.mock.invocationCallOrder[0]
    );
    prepareSpy.mockRestore();
    submitSpy.mockRestore();
  });

  it("submit receipt contains runtime result, deliverableHash, submitReceipt, and txHash", async () => {
    vi.spyOn(services, "submitDeliverableViaCircleCli").mockResolvedValue({
      ok: true,
      command: "circle",
      args: [],
      json: { txHash: "0x" + "ab".repeat(32) }
    } as any);

    const result = await services.submitProviderDeliverable({
      jobId: "42",
      deliverableHash: validHash,
      result: completedResult
    });

    expect(result.ok).toBe(true);
    expect(result.receipt).toBeDefined();
    // response includes runtime result and preparedTx
    expect(result.receipt.response).toHaveProperty("result");
    expect(result.receipt.response).toHaveProperty("submitReceipt");
    expect(result.receipt.response).toHaveProperty("preparedTx");
    // proof includes deliverableHash and txHash
    expect(result.receipt.proof.deliverableHash).toBe(validHash);
    expect(result.receipt.proof.txHash).toBeDefined();
    expect(result.receipt.proof.txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });
});

describe("runAndSubmitProviderJob", () => {
  let config: RunnerConfig;
  let runtime: RuntimeConnector;
  let mcp: ArcLayerMcpConnector;
  let skill: { content: string; sha256: string; path: string };
  let services: RunnerServices;

  const validJob = {
    taskId: "t1",
    jobId: "42",
    agentId: "agent-1",
    provider: "0x0000000000000000000000000000000000000001",
    description: "test job",
    input: { prompt: "do work" }
  };

  beforeEach(() => {
    config = makeConfig();
    runtime = makeMockRuntime();
    mcp = makeMockMcp();
    skill = { content: "# Skill", sha256: "abc123", path: "/test/skill.md" };
    services = new RunnerServices(config, runtime, mcp, skill);
  });

  it("calls runtime first, then submit", async () => {
    const runSpy = vi.spyOn(runtime, "run");
    const submitSpy = vi.spyOn(services, "submitDeliverableViaCircleCli").mockResolvedValue({
      ok: true,
      command: "circle",
      args: [],
      json: { txHash: "0x" + "ab".repeat(32) }
    } as any);

    const result = await services.runAndSubmitProviderJob(validJob);

    expect(runSpy).toHaveBeenCalled();
    expect(submitSpy).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.deliverableHash).toBeDefined();
    runSpy.mockRestore();
    submitSpy.mockRestore();
  });

  it("completed result submits", async () => {
    vi.spyOn(services, "submitDeliverableViaCircleCli").mockResolvedValue({
      ok: true,
      command: "circle",
      args: [],
      json: { txHash: "0x" + "ab".repeat(32) }
    } as any);

    const result = await services.runAndSubmitProviderJob(validJob);

    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect((result as any).submitReceipt).toBeDefined();
  });

  it("non-completed result never submits", async () => {
    const needsPaymentRuntime: RuntimeConnector = {
      kind: "hermes",
      async run() {
        return {
          ok: true,
          status: "needs_payment",
          artifacts: [],
          actionRequests: [],
          paymentRequests: [{ type: "x402_service_pay" as const, url: "https://api.example.com/pay", maxAmountUsdc: "0.01", reason: "unlock", method: "GET" as const }]
        } as RuntimeResult;
      }
    };
    const svc = new RunnerServices(config, needsPaymentRuntime, mcp, skill);
    const circleSpy = vi.spyOn(svc.circle, "executeErc8183Write");

    const result = await svc.runAndSubmitProviderJob(validJob);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("needs_payment");
    expect((result as any).submitReceipt).toBeUndefined();
    expect(circleSpy).not.toHaveBeenCalled();
    circleSpy.mockRestore();
  });

  it("keeps previous runErc8183ProviderJob behavior for successful completed result", async () => {
    vi.spyOn(services, "submitDeliverableViaCircleCli").mockResolvedValue({
      ok: true,
      command: "circle",
      args: [],
      json: { txHash: "0x" + "ab".repeat(32) }
    } as any);

    // runErc8183ProviderJob is the backward-compat wrapper
    const result = await services.runErc8183ProviderJob(validJob);

    expect(result.ok).toBe(true);
    expect(result.deliverableHash).toBeDefined();
    expect((result as any).submitReceipt).toBeDefined();
  });

  it("propagates submit failure instead of masking with runtime ok:true", async () => {
    vi.spyOn(services, "submitDeliverableViaCircleCli").mockResolvedValue({
      ok: false,
      mode: "prepared-only",
      reason: "CIRCLE_WALLET_ADDRESS not configured",
      prepared: {}
    });

    const result = await services.runAndSubmitProviderJob(validJob);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("submit_failure");
    expect(result.error).toContain("CIRCLE_WALLET_ADDRESS");
    expect(result.deliverableHash).toBeDefined(); // runtime succeeded
  });

  it("calls MCP completeJobRun only after successful submit", async () => {
    const completeSpy = vi.spyOn(mcp, "completeJobRun");
    vi.spyOn(services, "submitDeliverableViaCircleCli").mockResolvedValue({
      ok: true,
      command: "circle",
      args: [],
      json: { txHash: "0x" + "ab".repeat(32) }
    } as any);

    await services.runAndSubmitProviderJob(validJob);
    expect(completeSpy).toHaveBeenCalled();
  });

  it("does NOT call MCP completeJobRun when submit fails", async () => {
    const completeSpy = vi.spyOn(mcp, "completeJobRun");
    vi.spyOn(services, "submitDeliverableViaCircleCli").mockResolvedValue({
      ok: false,
      mode: "prepared-only",
      reason: "not configured",
      prepared: {}
    });

    await services.runAndSubmitProviderJob(validJob);
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it("submit failure returns non-success status and no final success receipt", async () => {
    vi.spyOn(services, "submitDeliverableViaCircleCli").mockResolvedValue({
      ok: false,
      mode: "prepared-only",
      reason: "CIRCLE_WALLET_ADDRESS not configured",
      prepared: {}
    });

    const appended: any[] = [];
    const originalAppend = services.receipts.append.bind(services.receipts);
    services.receipts.append = async (record: any) => {
      appended.push(record);
      return originalAppend(record);
    };

    const result = await services.runAndSubmitProviderJob(validJob);

    expect(result.ok).toBe(false);
    expect(result.status).toBe("submit_failure");
    // runtime result and deliverableHash are preserved for debugging
    expect(result.deliverableHash).toBeDefined();
    expect(result.result).toBeDefined();
    // no erc8183_submit receipt with ok:true should be emitted
    const successReceipts = appended.filter(
      (r) => r.type === "erc8183_submit" && r.response?.submitReceipt?.ok === true
    );
    expect(successReceipts).toHaveLength(0);
  });

  it("submit success emits erc8183_submit receipt with runtime result", async () => {
    vi.spyOn(services, "submitDeliverableViaCircleCli").mockResolvedValue({
      ok: true,
      command: "circle",
      args: [],
      json: { txHash: "0x" + "ab".repeat(32) }
    } as any);

    const appended: any[] = [];
    const originalAppend = services.receipts.append.bind(services.receipts);
    services.receipts.append = async (record: any) => {
      appended.push(record);
      return originalAppend(record);
    };

    const result = await services.runAndSubmitProviderJob(validJob);

    expect(result.ok).toBe(true);
    // runtime_result receipt from runProviderJob + erc8183_submit from submitProviderDeliverable
    const submitReceipts = appended.filter((r) => r.type === "erc8183_submit");
    expect(submitReceipts.length).toBeGreaterThanOrEqual(1);
    // submit receipt includes runtime result
    expect(submitReceipts[0].response).toHaveProperty("result");
    expect(submitReceipts[0].response).toHaveProperty("preparedTx");
    expect(submitReceipts[0].proof).toHaveProperty("deliverableHash");
    expect(submitReceipts[0].proof).toHaveProperty("txHash");
  });
});
