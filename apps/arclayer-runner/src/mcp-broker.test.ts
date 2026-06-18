import { describe, it, expect, beforeEach } from "vitest";
import {
  McpToolBroker,
  BrokerError,
  BrokerErrorCode,
  isNonIdempotentWrite,
  isBrokerAbortOrTimeout,
  type ToolBudgetConfig,
} from "./mcp-broker";

describe("McpToolBroker", () => {
  let broker: McpToolBroker;

  beforeEach(() => {
    broker = new McpToolBroker({
      maxCalls: 5,
      maxTotalUsdc: "1.0",
      defaultTimeoutMs: 5000,
      maxOutputBytes: 1024,
      timeoutOverridesMs: { "x402.pay": 30_000 },
      outputSizeOverridesBytes: { "runner.manifest": 4096 },
    });
  });

  // ── Schema Validation ─────────────────────────────────────────────────

  describe("schema validation", () => {
    it("passes validation for tool with no schema", () => {
      expect(() => broker.validateArgs("runner.health", {})).not.toThrow();
    });

    it("passes validation when all required fields present", () => {
      expect(() =>
        broker.validateArgs("x402.inspect", { url: "https://api.example.com/test" })
      ).not.toThrow();
    });

    it("fails validation when required field missing", () => {
      expect(() => broker.validateArgs("x402.pay", { url: "https://api.example.com/test" }))
        .toThrow(BrokerError);
      try {
        broker.validateArgs("x402.pay", { url: "https://api.example.com/test" });
      } catch (e) {
        expect(e).toBeInstanceOf(BrokerError);
        expect((e as BrokerError).code).toBe(BrokerErrorCode.SCHEMA_VALIDATION_FAILED);
        expect((e as BrokerError).message).toContain("maxAmountUsdc");
      }
    });

    it("fails validation when field has wrong type", () => {
      expect(() =>
        broker.validateArgs("runner.receipts", { limit: "not-a-number" })
      ).toThrow(BrokerError);
    });

    it("passes validation for correct types", () => {
      expect(() =>
        broker.validateArgs("runner.receipts", { limit: 10 })
      ).not.toThrow();
    });

    it("passes validation for proxy tools (no schema check)", () => {
      expect(() =>
        broker.validateArgs("identity.prepare_register_agent", { metadataURI: "https://example.com" })
      ).not.toThrow();
    });

    it("accepts arrays for object-typed fields (x402 body)", () => {
      // x402.inspect has body: { type: "object" } — should accept any JSON value
      expect(() =>
        broker.validateArgs("x402.inspect", { url: "https://example.com", body: [1, 2, 3] })
      ).not.toThrow();
    });

    it("accepts primitives for object-typed fields", () => {
      expect(() =>
        broker.validateArgs("x402.inspect", { url: "https://example.com", body: "raw-string" })
      ).not.toThrow();
    });
  });

  // ── Tool Allowlist / Manifest Pinning ─────────────────────────────────

  describe("tool allowlist", () => {
    it("allows tools that exist in manifest", () => {
      expect(() => broker.assertToolAllowed("runner.health")).not.toThrow();
      expect(() => broker.assertToolAllowed("x402.pay")).not.toThrow();
      expect(() => broker.assertToolAllowed("erc8183.create_job")).not.toThrow();
    });

    it("allows console proxy tools (pass-through)", () => {
      expect(() => broker.assertToolAllowed("identity.prepare_register_agent")).not.toThrow();
    });

    it("rejects truly unknown tools", () => {
      expect(() => broker.assertToolAllowed("totally.fake.tool")).toThrow(BrokerError);
      try {
        broker.assertToolAllowed("totally.fake.tool");
      } catch (e) {
        expect(e).toBeInstanceOf(BrokerError);
        expect((e as BrokerError).code).toBe(BrokerErrorCode.TOOL_NOT_FOUND);
      }
    });
  });

  // ── Timeout ───────────────────────────────────────────────────────────

  describe("timeout config", () => {
    it("returns default timeout for tools without override", () => {
      expect(broker.getTimeoutMs("runner.health")).toBe(5000);
    });

    it("returns overridden timeout for tools with override", () => {
      expect(broker.getTimeoutMs("x402.pay")).toBe(30_000);
    });

    it("uses 30s default when no config provided", () => {
      const defaultBroker = new McpToolBroker();
      expect(defaultBroker.getTimeoutMs("any.tool")).toBe(30_000);
    });
  });

  // ── Budget / Max Calls ────────────────────────────────────────────────

  describe("budget enforcement", () => {
    it("allows calls within budget", () => {
      expect(() => broker.assertBudgetAllowed()).not.toThrow();
    });

    it("rejects when max calls exceeded (including pending)", () => {
      // Exhaust the budget — use recordCall to increment callCount
      for (let i = 0; i < 5; i++) {
        broker.recordCall({
          toolName: "runner.health",
          args: {},
          ok: true,
          durationMs: 10,
          outputBytes: 50,
        });
      }

      expect(() => broker.assertBudgetAllowed()).toThrow(BrokerError);
      try {
        broker.assertBudgetAllowed();
      } catch (e) {
        expect(e).toBeInstanceOf(BrokerError);
        expect((e as BrokerError).code).toBe(BrokerErrorCode.MAX_CALLS_EXCEEDED);
      }
    });

    it("includes pending calls in budget check", () => {
      // Fill up with 3 completed + 2 pending = 5 (at limit)
      for (let i = 0; i < 3; i++) {
        broker.recordCall({ toolName: "a", args: {}, ok: true, durationMs: 1, outputBytes: 1 });
      }
      broker.reserveCallSlot();
      broker.reserveCallSlot();

      // 5 total (3 done + 2 pending) = at limit, should reject
      expect(() => broker.assertBudgetAllowed()).toThrow(BrokerError);
    });

    it("rejects when total spend exceeds budget", () => {
      broker.recordCall({
        toolName: "x402.pay",
        args: { maxAmountUsdc: "1.5" }, // cost extracted from args now
        ok: true,
        durationMs: 100,
        outputBytes: 50,
        costUsdc: "1.5",
      });

      expect(() => broker.assertBudgetAllowed()).toThrow(BrokerError);
      try {
        broker.assertBudgetAllowed();
      } catch (e) {
        expect(e).toBeInstanceOf(BrokerError);
        expect((e as BrokerError).code).toBe(BrokerErrorCode.BUDGET_EXCEEDED);
      }
    });
  });

  // ── Output Size Cap ───────────────────────────────────────────────────

  describe("output size cap", () => {
    it("allows output within limit", () => {
      const smallResult = { ok: true, data: "small" };
      expect(() => broker.assertOutputSize("runner.health", smallResult)).not.toThrow();
    });

    it("rejects output exceeding default limit", () => {
      const largeResult = { ok: true, data: "x".repeat(2000) };
      expect(() => broker.assertOutputSize("runner.health", largeResult)).toThrow(BrokerError);
      try {
        broker.assertOutputSize("runner.health", largeResult);
      } catch (e) {
        expect(e).toBeInstanceOf(BrokerError);
        expect((e as BrokerError).code).toBe(BrokerErrorCode.OUTPUT_TOO_LARGE);
      }
    });

    it("uses per-tool output size override", () => {
      // runner.manifest has 4096 byte override
      const mediumResult = { ok: true, data: "x".repeat(3000) };
      expect(() => broker.assertOutputSize("runner.manifest", mediumResult)).not.toThrow();
    });
  });

  // ── Audit Log ─────────────────────────────────────────────────────────

  describe("audit logging", () => {
    it("records successful calls", () => {
      broker.recordCall({
        toolName: "runner.health",
        args: {},
        ok: true,
        durationMs: 15,
        outputBytes: 100,
      });

      const log = broker.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].toolName).toBe("runner.health");
      expect(log[0].ok).toBe(true);
      expect(log[0].durationMs).toBe(15);
      expect(log[0].outputBytes).toBe(100);
      expect(log[0].timestamp).toBeDefined();
    });

    it("records failed calls with error info", () => {
      broker.recordCall({
        toolName: "x402.pay",
        args: { url: "https://example.com" },
        ok: false,
        durationMs: 50,
        outputBytes: 0,
        errorCode: BrokerErrorCode.BUDGET_EXCEEDED,
        errorMessage: "Budget exceeded",
      });

      const log = broker.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].ok).toBe(false);
      expect(log[0].errorCode).toBe(BrokerErrorCode.BUDGET_EXCEEDED);
    });

    it("tracks call count", () => {
      expect(broker.getState().callCount).toBe(0);

      broker.recordCall({ toolName: "a", args: {}, ok: true, durationMs: 1, outputBytes: 1 });
      broker.recordCall({ toolName: "b", args: {}, ok: true, durationMs: 1, outputBytes: 1 });

      expect(broker.getState().callCount).toBe(2);
    });

    it("tracks total cost from request args", () => {
      broker.recordCall({
        toolName: "x402.pay",
        args: { maxAmountUsdc: "0.5" },
        ok: true,
        durationMs: 100,
        outputBytes: 50,
        costUsdc: "0.5",
      });

      broker.recordCall({
        toolName: "x402.pay",
        args: { maxAmountUsdc: "0.3" },
        ok: true,
        durationMs: 100,
        outputBytes: 50,
        costUsdc: "0.3",
      });

      const state = broker.getState();
      expect(state.totalCostMicros).toBe(800000n); // 0.8 USDC in micros
    });

    it("redacts sensitive fields from args", () => {
      broker.recordCall({
        toolName: "x402.pay",
        args: {
          url: "https://api.example.com/test",
          maxAmountUsdc: "0.01",
          idempotencyKey: "secret-key-123",
          body: { token: "bearer-secret" },
        },
        ok: true,
        durationMs: 100,
        outputBytes: 50,
      });

      const log = broker.getAuditLog();
      expect(log[0].args.url).toBe("https://api.example.com/test");
      expect(log[0].args.maxAmountUsdc).toBe("0.01");
      expect(log[0].args.idempotencyKey).toBe("[REDACTED]");
      expect(log[0].args.body).toBe("[REDACTED]");
    });

    it("redacts URLs with embedded credentials", () => {
      broker.recordCall({
        toolName: "x402.inspect",
        args: { url: "https://user:pass@api.example.com/test" },
        ok: true,
        durationMs: 10,
        outputBytes: 10,
      });

      const log = broker.getAuditLog();
      expect(log[0].args.url).not.toContain("pass");
      expect(log[0].args.url).toContain("***");
    });
  });

  // ── Call Slot Management ──────────────────────────────────────────────

  describe("call slot management", () => {
    it("reserveCallSlot increments pendingCalls", () => {
      expect(broker.getState().pendingCalls).toBe(0);
      broker.reserveCallSlot();
      expect(broker.getState().pendingCalls).toBe(1);
      broker.reserveCallSlot();
      expect(broker.getState().pendingCalls).toBe(2);
    });

    it("releaseCallSlot decrements pendingCalls", () => {
      broker.reserveCallSlot();
      broker.reserveCallSlot();
      broker.releaseCallSlot();
      expect(broker.getState().pendingCalls).toBe(1);
    });

    it("releaseCallSlot never goes below 0", () => {
      broker.releaseCallSlot();
      broker.releaseCallSlot();
      expect(broker.getState().pendingCalls).toBe(0);
    });

    it("postExecute releases call slot", () => {
      broker.reserveCallSlot();
      expect(broker.getState().pendingCalls).toBe(1);
      broker.postExecute("runner.health", {}, { ok: true }, 10);
      expect(broker.getState().pendingCalls).toBe(0);
    });

    it("recordFailure releases call slot", () => {
      broker.reserveCallSlot();
      expect(broker.getState().pendingCalls).toBe(1);
      broker.recordFailure("runner.health", {}, new Error("fail"), 10);
      expect(broker.getState().pendingCalls).toBe(0);
    });
  });

  // ── Rejection Recording ───────────────────────────────────────────────

  describe("rejection recording", () => {
    it("recordRejection creates audit entry for pre-execution denials", () => {
      const error = new BrokerError(BrokerErrorCode.MAX_CALLS_EXCEEDED, "limit hit");
      broker.recordRejection("x402.pay", { url: "https://example.com" }, error);

      const log = broker.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].ok).toBe(false);
      expect(log[0].errorCode).toBe(BrokerErrorCode.MAX_CALLS_EXCEEDED);
      expect(log[0].durationMs).toBe(0);
    });
  });

  // ── Cost Extraction from Args ─────────────────────────────────────────

  describe("cost extraction from args", () => {
    it("extracts cost from x402.pay args.maxAmountUsdc", () => {
      // Use preExecute + postExecute to trigger full lifecycle
      broker.preExecute("x402.pay", {
        url: "https://api.example.com",
        maxAmountUsdc: "0.5",
        reason: "test",
      });
      const result = broker.postExecute(
        "x402.pay",
        { url: "https://api.example.com", maxAmountUsdc: "0.5", reason: "test" },
        { ok: true, result: {}, receipt: {}, idempotencyKey: "key" },
        100
      );

      expect(broker.getState().totalCostMicros).toBe(500000n);
    });

    it("extracts cost from x402.batch_pay args.payments", () => {
      broker.preExecute("x402.batch_pay", {
        batchId: "b1",
        taskId: "t1",
        payments: [
          { url: "https://a.com", maxAmountUsdc: "0.1", reason: "r1" },
          { url: "https://b.com", maxAmountUsdc: "0.2", reason: "r2" },
        ],
      });
      broker.postExecute(
        "x402.batch_pay",
        {
          batchId: "b1",
          taskId: "t1",
          payments: [
            { url: "https://a.com", maxAmountUsdc: "0.1", reason: "r1" },
            { url: "https://b.com", maxAmountUsdc: "0.2", reason: "r2" },
          ],
        },
        { ok: true, results: [], receipt: {} },
        100
      );

      expect(broker.getState().totalCostMicros).toBe(300000n); // 0.3 USDC
    });

    it("returns 0n for non-payment tools", () => {
      broker.preExecute("runner.health", {});
      broker.postExecute("runner.health", {}, { ok: true }, 10);

      expect(broker.getState().totalCostMicros).toBe(0n);
    });
  });

  // ── Blocker 3: Pre-execution payment budget check ────────────────────

  describe("Blocker 3 — pre-execution payment budget check", () => {
    it("x402.pay maxAmountUsdc=100 blocked when budget is 10 and spent is 0", () => {
      const smallBroker = new McpToolBroker({
        maxCalls: 100,
        maxTotalUsdc: "10",
      });

      expect(() =>
        smallBroker.preExecute("x402.pay", {
          url: "https://api.example.com",
          maxAmountUsdc: "100",
          reason: "test",
        })
      ).toThrow(BrokerError);

      try {
        smallBroker.preExecute("x402.pay", {
          url: "https://api.example.com",
          maxAmountUsdc: "100",
          reason: "test",
        });
      } catch (e) {
        expect(e).toBeInstanceOf(BrokerError);
        expect((e as BrokerError).code).toBe(BrokerErrorCode.BUDGET_EXCEEDED);
        expect((e as BrokerError).message).toContain("exceeds remaining budget");
      }
    });

    it("batch sum over remaining budget is blocked", () => {
      const smallBroker = new McpToolBroker({
        maxCalls: 100,
        maxTotalUsdc: "0.5",
      });

      expect(() =>
        smallBroker.preExecute("x402.batch_pay", {
          batchId: "b1",
          taskId: "t1",
          payments: [
            { url: "https://a.com", maxAmountUsdc: "0.3", reason: "r1" },
            { url: "https://b.com", maxAmountUsdc: "0.4", reason: "r2" }, // 0.3 + 0.4 = 0.7 > 0.5
          ],
        })
      ).toThrow(BrokerError);
    });

    it("payment within remaining budget passes", () => {
      const smallBroker = new McpToolBroker({
        maxCalls: 100,
        maxTotalUsdc: "1.0",
      });

      expect(() =>
        smallBroker.preExecute("x402.pay", {
          url: "https://api.example.com",
          maxAmountUsdc: "0.5",
          reason: "test",
        })
      ).not.toThrow();

      // Clean up
      smallBroker.postExecute("x402.pay", { url: "https://api.example.com", maxAmountUsdc: "0.5", reason: "test" }, { ok: true }, 10);
    });

    it("postExecute still records committed cost", () => {
      const smallBroker = new McpToolBroker({
        maxCalls: 100,
        maxTotalUsdc: "10",
      });

      smallBroker.preExecute("x402.pay", {
        url: "https://api.example.com",
        maxAmountUsdc: "2.5",
        reason: "test",
      });
      smallBroker.postExecute("x402.pay", { url: "https://api.example.com", maxAmountUsdc: "2.5", reason: "test" }, { ok: true }, 100);

      expect(smallBroker.getState().totalCostMicros).toBe(2500000n); // 2.5 USDC

      const log = smallBroker.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].costUsdc).toBe("2.500000");
    });

    it("second payment blocked after first consumed most of budget", () => {
      const smallBroker = new McpToolBroker({
        maxCalls: 100,
        maxTotalUsdc: "1.0",
      });

      // First: 0.8 USDC — passes
      smallBroker.preExecute("x402.pay", {
        url: "https://a.com",
        maxAmountUsdc: "0.8",
        reason: "r1",
      });
      smallBroker.postExecute("x402.pay", { url: "https://a.com", maxAmountUsdc: "0.8", reason: "r1" }, { ok: true }, 10);
      expect(smallBroker.getState().totalCostMicros).toBe(800000n);

      // Second: 0.5 USDC — 0.8 + 0.5 = 1.3 > 1.0 — should fail
      expect(() =>
        smallBroker.preExecute("x402.pay", {
          url: "https://b.com",
          maxAmountUsdc: "0.5",
          reason: "r2",
        })
      ).toThrow(BrokerError);
    });
  });

  // ── Full Lifecycle (preExecute + postExecute) ─────────────────────────

  describe("full lifecycle", () => {
    it("preExecute validates tool + schema + budget + reserves slot", () => {
      broker.preExecute("runner.health", {});
      expect(broker.getState().pendingCalls).toBe(1);
      // Clean up
      broker.postExecute("runner.health", {}, { ok: true }, 10);
    });

    it("preExecute rejects unknown tool", () => {
      expect(() =>
        broker.preExecute("totally.fake.tool", {})
      ).toThrow(BrokerError);
      // No slot reserved on rejection
      expect(broker.getState().pendingCalls).toBe(0);
    });

    it("preExecute rejects invalid args (no slot reserved)", () => {
      expect(() =>
        broker.preExecute("x402.pay", { url: "https://example.com" })
      ).toThrow(BrokerError);
      expect(broker.getState().pendingCalls).toBe(0);
    });

    it("postExecute validates output size and records audit", () => {
      broker.preExecute("runner.health", {});
      const result = broker.postExecute(
        "runner.health",
        {},
        { ok: true },
        15
      );
      expect(result).toEqual({ ok: true });
      expect(broker.getAuditLog()).toHaveLength(1);
      expect(broker.getState().pendingCalls).toBe(0);
    });

    it("postExecute rejects oversized output (releases slot)", () => {
      broker.preExecute("runner.health", {});
      const largeResult = { ok: true, data: "x".repeat(2000) };
      expect(() =>
        broker.postExecute("runner.health", {}, largeResult, 10)
      ).toThrow(BrokerError);
      expect(broker.getState().pendingCalls).toBe(0);
    });
  });

  // ── Stable Error Codes ────────────────────────────────────────────────

  describe("stable error codes", () => {
    it("all BrokerErrorCode values are strings", () => {
      for (const code of Object.values(BrokerErrorCode)) {
        expect(typeof code).toBe("string");
        expect(code.startsWith("BROKER_")).toBe(true);
      }
    });

    it("BrokerError carries code, message, and details", () => {
      const error = new BrokerError(
        BrokerErrorCode.SCHEMA_VALIDATION_FAILED,
        "Missing required field",
        { field: "url" }
      );

      expect(error.code).toBe(BrokerErrorCode.SCHEMA_VALIDATION_FAILED);
      expect(error.message).toBe("Missing required field");
      expect(error.details).toEqual({ field: "url" });
      expect(error.name).toBe("BrokerError");
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("works with no budget config (defaults)", () => {
      const defaultBroker = new McpToolBroker();
      expect(() => defaultBroker.assertBudgetAllowed()).not.toThrow();
      expect(defaultBroker.getTimeoutMs("any")).toBe(30_000);
      expect(defaultBroker.getMaxOutputBytes("any")).toBe(1_048_576);
    });

    it("getState returns readonly snapshot", () => {
      const state = broker.getState();
      expect(state.callCount).toBe(0);
      expect(state.pendingCalls).toBe(0);
      expect(state.totalCostMicros).toBe(0n);
      expect(state.auditLog).toEqual([]);
    });

    it("getAuditLog returns readonly array", () => {
      const log = broker.getAuditLog();
      expect(log).toHaveLength(0);
    });
  });

  // ── Non-idempotent write tool timeout ──────────────────────────────────

  describe("non-idempotent write tool defaults", () => {
    it("isNonIdempotentWrite returns true for x402 payment tools", () => {
      expect(isNonIdempotentWrite("x402.pay")).toBe(true);
      expect(isNonIdempotentWrite("x402.batch_pay")).toBe(true);
    });

    it("isNonIdempotentWrite returns true for all erc8183 lifecycle writes", () => {
      const tools = [
        "erc8183.provider_submit_deliverable",
        "erc8183.provider_run_and_submit",
        "erc8183.create_job",
        "erc8183.set_budget",
        "erc8183.approve_usdc",
        "erc8183.fund_job",
        "erc8183.complete_job",
        "erc8183.reject_job",
        "erc8183.claim_refund",
        "erc8183.set_provider",
      ];
      for (const tool of tools) {
        expect(isNonIdempotentWrite(tool)).toBe(true);
      }
    });

    it("isNonIdempotentWrite returns true for identity and gateway writes", () => {
      expect(isNonIdempotentWrite("erc8004.register_execute")).toBe(true);
      expect(isNonIdempotentWrite("erc8004.register_approval_execute")).toBe(true);
      expect(isNonIdempotentWrite("erc8004.register_approval_approve_and_execute")).toBe(true);
      expect(isNonIdempotentWrite("circle.gateway_deposit")).toBe(true);
    });

    it("isNonIdempotentWrite returns false for read-only tools", () => {
      expect(isNonIdempotentWrite("runner.health")).toBe(false);
      expect(isNonIdempotentWrite("x402.inspect")).toBe(false);
      expect(isNonIdempotentWrite("runner.audit_log")).toBe(false);
      expect(isNonIdempotentWrite("circle.status")).toBe(false);
    });

    it("every write tool in tool-registry (risk: external-process|payment) is covered", () => {
      // Canonical list of tools that perform on-chain writes or payments.
      // Derived from tool-registry.ts risk labels: "external-process", "payment".
      // If a new write tool is added to the registry, it MUST be added to
      // NON_IDEMPOTENT_WRITE_TOOLS or this test will fail.
      const registryWriteTools = [
        "x402.pay",
        "x402.batch_pay",
        "erc8183.provider_submit_deliverable",
        "erc8183.provider_run_and_submit",
        "erc8183.create_job",
        "erc8183.set_budget",
        "erc8183.approve_usdc",
        "erc8183.fund_job",
        "erc8183.complete_job",
        "erc8183.reject_job",
        "erc8183.claim_refund",
        "erc8183.set_provider",
        "erc8004.register_execute",
        "circle.gateway_deposit",
      ];
      for (const tool of registryWriteTools) {
        expect(isNonIdempotentWrite(tool)).toBe(true);
      }
    });

    it("getTimeoutMs returns 120s for write tools by default (no defaultTimeoutMs)", () => {
      const defaultBroker = new McpToolBroker();
      expect(defaultBroker.getTimeoutMs("x402.pay")).toBe(120_000);
      expect(defaultBroker.getTimeoutMs("erc8183.provider_submit_deliverable")).toBe(120_000);
      expect(defaultBroker.getTimeoutMs("erc8183.fund_job")).toBe(120_000);
      expect(defaultBroker.getTimeoutMs("circle.gateway_deposit")).toBe(120_000);
    });

    it("getTimeoutMs returns 120s for write tools EVEN WHEN defaultTimeoutMs=30000", () => {
      // This is the critical case: RunnerConfigSchema defaults defaultTimeoutMs
      // to 30000, which must NOT shadow the write tool 120s default.
      const brokerWith30s = new McpToolBroker({ defaultTimeoutMs: 30_000 });
      expect(brokerWith30s.getTimeoutMs("x402.pay")).toBe(120_000);
      expect(brokerWith30s.getTimeoutMs("erc8183.fund_job")).toBe(120_000);
      expect(brokerWith30s.getTimeoutMs("erc8183.provider_submit_deliverable")).toBe(120_000);
      expect(brokerWith30s.getTimeoutMs("erc8183.complete_job")).toBe(120_000);
      expect(brokerWith30s.getTimeoutMs("circle.gateway_deposit")).toBe(120_000);
    });

    it("getTimeoutMs returns 30s for non-write tools by default", () => {
      const defaultBroker = new McpToolBroker();
      expect(defaultBroker.getTimeoutMs("runner.health")).toBe(30_000);
      expect(defaultBroker.getTimeoutMs("x402.inspect")).toBe(30_000);
    });

    it("getTimeoutMs returns defaultTimeoutMs for read tools when configured", () => {
      const customBroker = new McpToolBroker({ defaultTimeoutMs: 45_000 });
      expect(customBroker.getTimeoutMs("runner.health")).toBe(45_000);
      expect(customBroker.getTimeoutMs("x402.inspect")).toBe(45_000);
    });

    it("explicit timeoutOverridesMs wins over write tool default", () => {
      const customBroker = new McpToolBroker({
        timeoutOverridesMs: { "x402.pay": 60_000 },
      });
      expect(customBroker.getTimeoutMs("x402.pay")).toBe(60_000);
    });

    it("explicit timeoutOverridesMs wins over write tool default even with defaultTimeoutMs", () => {
      const customBroker = new McpToolBroker({
        defaultTimeoutMs: 30_000,
        timeoutOverridesMs: { "x402.pay": 60_000 },
      });
      expect(customBroker.getTimeoutMs("x402.pay")).toBe(60_000);
      // Other write tools still get 120s
      expect(customBroker.getTimeoutMs("erc8183.fund_job")).toBe(120_000);
    });
  });

  // ── Timeout audit distinction ──────────────────────────────────────────

  describe("timeout audit distinction", () => {
    it("recordFailure with timedOut=true sets timedOut on audit entry for write tools", () => {
      broker.recordFailure(
        "x402.pay",
        { url: "https://api.test", maxAmountUsdc: "1.0" },
        new BrokerError(BrokerErrorCode.TOOL_TIMEOUT, "timed out", {}),
        5000,
        true
      );

      const log = broker.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].ok).toBe(false);
      expect(log[0].errorCode).toBe(BrokerErrorCode.TOOL_TIMEOUT);
      expect(log[0].timedOut).toBe(true);
    });

    it("recordFailure with timedOut=true sets timedOut for erc8183 write tools", () => {
      broker.recordFailure(
        "erc8183.fund_job",
        { jobId: "123" },
        new BrokerError(BrokerErrorCode.TOOL_TIMEOUT, "timed out", {}),
        5000,
        true
      );

      const log = broker.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].timedOut).toBe(true);
    });

    it("recordFailure with timedOut=true does NOT set timedOut for non-write tools", () => {
      broker.recordFailure(
        "runner.health",
        {},
        new BrokerError(BrokerErrorCode.TOOL_TIMEOUT, "timed out", {}),
        5000,
        true
      );

      const log = broker.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].timedOut).toBeUndefined();
    });

    it("recordFailure with timedOut=false does NOT set timedOut for write tools", () => {
      broker.recordFailure(
        "x402.pay",
        { url: "https://api.test", maxAmountUsdc: "1.0" },
        new Error("some error"),
        5000,
        false
      );

      const log = broker.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].timedOut).toBeUndefined();
    });

    it("recordFailure default timedOut is false", () => {
      broker.recordFailure(
        "x402.pay",
        { url: "https://api.test", maxAmountUsdc: "1.0" },
        new Error("some error"),
        5000
      );

      const log = broker.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].timedOut).toBeUndefined();
    });
  });

  // ── isBrokerAbortOrTimeout ─────────────────────────────────────────────

  describe("isBrokerAbortOrTimeout", () => {
    it("returns true for BrokerError with TOOL_TIMEOUT code", () => {
      const error = new BrokerError(BrokerErrorCode.TOOL_TIMEOUT, "timed out", {});
      expect(isBrokerAbortOrTimeout(error)).toBe(true);
    });

    it("returns true for BrokerError TOOL_TIMEOUT even without signal", () => {
      const error = new BrokerError(BrokerErrorCode.TOOL_TIMEOUT, "timed out", {});
      expect(isBrokerAbortOrTimeout(error, undefined)).toBe(true);
    });

    it("returns true when signal is already aborted", () => {
      const controller = new AbortController();
      controller.abort();
      expect(isBrokerAbortOrTimeout(new Error("killed"), controller.signal)).toBe(true);
    });

    it("returns true for AbortError (Node execFile signal kill)", () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      expect(isBrokerAbortOrTimeout(error)).toBe(true);
    });

    it("returns true for error with code ABORT_ERR", () => {
      const error = { code: "ABORT_ERR", message: "aborted" };
      expect(isBrokerAbortOrTimeout(error)).toBe(true);
    });

    it("returns false for normal Error without signal abort", () => {
      expect(isBrokerAbortOrTimeout(new Error("ECONNREFUSED"))).toBe(false);
    });

    it("returns false for BrokerError with different code", () => {
      const error = new BrokerError(BrokerErrorCode.BUDGET_EXCEEDED, "over budget", {});
      expect(isBrokerAbortOrTimeout(error)).toBe(false);
    });

    it("returns false for non-aborted signal with normal error", () => {
      const controller = new AbortController();
      expect(isBrokerAbortOrTimeout(new Error("timeout"), controller.signal)).toBe(false);
    });

    it("returns false for null/undefined error without signal", () => {
      expect(isBrokerAbortOrTimeout(null)).toBe(false);
      expect(isBrokerAbortOrTimeout(undefined)).toBe(false);
    });
  });
});
