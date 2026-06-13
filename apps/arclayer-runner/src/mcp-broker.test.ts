import { describe, it, expect, beforeEach } from "vitest";
import {
  McpToolBroker,
  BrokerError,
  BrokerErrorCode,
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
      // Console proxy tools skip schema validation
      expect(() =>
        broker.validateArgs("identity.prepare_register_agent", { metadataURI: "https://example.com" })
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
      // A tool that's not in schemas AND not in registry
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

    it("rejects when max calls exceeded", () => {
      // Exhaust the budget
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

    it("rejects when total spend exceeds budget", () => {
      broker.recordCall({
        toolName: "x402.pay",
        args: {},
        ok: true,
        durationMs: 100,
        outputBytes: 50,
        costUsdc: "1.5", // Over the 1.0 limit
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

    it("tracks total cost from payment tools", () => {
      broker.recordCall({
        toolName: "x402.pay",
        args: {},
        ok: true,
        durationMs: 100,
        outputBytes: 50,
        costUsdc: "0.5",
      });

      broker.recordCall({
        toolName: "x402.pay",
        args: {},
        ok: true,
        durationMs: 100,
        outputBytes: 50,
        costUsdc: "0.3",
      });

      const state = broker.getState();
      expect(state.totalCostMicros).toBe(800000n); // 0.8 USDC in micros
    });
  });

  // ── Full Lifecycle (preExecute + postExecute) ─────────────────────────

  describe("full lifecycle", () => {
    it("preExecute validates tool + schema + budget", () => {
      expect(() =>
        broker.preExecute("runner.health", {})
      ).not.toThrow();
    });

    it("preExecute rejects unknown tool", () => {
      expect(() =>
        broker.preExecute("totally.fake.tool", {})
      ).toThrow(BrokerError);
    });

    it("preExecute rejects invalid args", () => {
      expect(() =>
        broker.preExecute("x402.pay", { url: "https://example.com" }) // missing required fields
      ).toThrow(BrokerError);
    });

    it("postExecute validates output size and records audit", () => {
      const result = broker.postExecute(
        "runner.health",
        {},
        { ok: true },
        15
      );
      expect(result).toEqual({ ok: true });
      expect(broker.getAuditLog()).toHaveLength(1);
    });

    it("postExecute rejects oversized output", () => {
      const largeResult = { ok: true, data: "x".repeat(2000) };
      expect(() =>
        broker.postExecute("runner.health", {}, largeResult, 10)
      ).toThrow(BrokerError);
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
      expect(state.totalCostMicros).toBe(0n);
      expect(state.auditLog).toEqual([]);
    });

    it("getAuditLog returns readonly array", () => {
      const log = broker.getAuditLog();
      expect(log).toHaveLength(0);
    });
  });
});
