/**
 * MCP Schema Parity Tests
 *
 * Proves that:
 * 1. tools/list inputSchema and execution validation schema agree
 * 2. Required vs optional field semantics match
 * 3. Default values are applied consistently
 * 4. Enum constraints are enforced
 * 5. Regex constraints (address, numeric, decimal, bytes32) are enforced
 * 6. Broker validation and validateMcpToolInput reject the same invalid payloads
 * 7. Valid payloads parse into normalized shape
 */

import { describe, it, expect } from "vitest";
import { RUNNER_MCP_TOOLS } from "./mcp-schemas";
import {
  MCP_TOOL_INPUT_SCHEMAS,
  getMcpToolInputSchema,
  safeValidateMcpToolInput,
  zodInputSchemaToJsonSchema,
} from "@arclayer/runner-core";
import { McpToolBroker, BrokerError, BrokerErrorCode } from "./mcp-broker";

// ── 1. Schema Registry Completeness ─────────────────────────────────────

describe("1. Schema Registry Completeness", () => {
  it("every Zod-registered tool has a RUNNER_MCP_TOOLS entry with inputSchema", () => {
    for (const toolName of Object.keys(MCP_TOOL_INPUT_SCHEMAS)) {
      const toolDef = RUNNER_MCP_TOOLS.find((t) => t.name === toolName);
      expect(toolDef, `${toolName} missing from RUNNER_MCP_TOOLS`).toBeDefined();
      expect(toolDef!.inputSchema, `${toolName} missing inputSchema`).toBeDefined();
    }
  });

  const WRITE_TOOLS = [
    "x402.inspect", "x402.pay", "x402.batch_pay",
    "erc8004.prepare_register", "erc8004.register_via_circle_cli",
    "erc8004.register_approval_create", "erc8004.register_approval_get",
    "erc8004.register_approval_approve", "erc8004.register_approval_reject",
    "erc8004.register_approval_execute", "erc8004.register_approval_approve_and_execute",
    "erc8183.provider_run_job", "erc8183.provider_submit_deliverable",
    "erc8183.provider_run_and_submit", "erc8183.create_job",
    "erc8183.set_budget", "erc8183.approve_usdc", "erc8183.fund_job",
    "erc8183.complete_job", "erc8183.reject_job", "erc8183.claim_refund",
    "erc8183.set_provider", "circle.gateway_deposit",
  ];

  it("every write tool has a Zod schema", () => {
    for (const toolName of WRITE_TOOLS) {
      expect(
        getMcpToolInputSchema(toolName),
        `${toolName} missing Zod schema`
      ).toBeDefined();
    }
  });

  it("Zod schema generates non-empty inputSchema for all registered tools", () => {
    for (const [toolName, zodSchema] of Object.entries(MCP_TOOL_INPUT_SCHEMAS)) {
      const jsonSchema = zodInputSchemaToJsonSchema(zodSchema);
      expect(jsonSchema, `${toolName} generated undefined inputSchema`).toBeDefined();
      expect(
        Object.keys(jsonSchema!).length,
        `${toolName} generated empty inputSchema`
      ).toBeGreaterThan(0);
    }
  });

  it("tools/list field names match Zod schema field names", () => {
    for (const toolName of Object.keys(MCP_TOOL_INPUT_SCHEMAS)) {
      const toolDef = RUNNER_MCP_TOOLS.find((t) => t.name === toolName)!;
      const zodSchema = getMcpToolInputSchema(toolName)!;
      const zodFields = Object.keys(zodInputSchemaToJsonSchema(zodSchema) ?? {});
      const toolFields = Object.keys(toolDef.inputSchema as Record<string, unknown>);
      expect(toolFields.sort(), `${toolName} field mismatch`).toEqual(zodFields.sort());
    }
  });
});

// ── 2. Required vs Optional Fields ───────────────────────────────────────

describe("2. Required vs Optional Fields", () => {
  const broker = new McpToolBroker();

  // x402.pay: url, maxAmountUsdc, reason are required; method, idempotencyKey, body are optional
  describe("x402.pay", () => {
    it("rejects missing url (required)", () => {
      expect(() => broker.validateArgs("x402.pay", {
        maxAmountUsdc: "0.01", reason: "test",
      })).toThrow(BrokerError);
    });

    it("rejects missing maxAmountUsdc (required)", () => {
      expect(() => broker.validateArgs("x402.pay", {
        url: "https://example.com", reason: "test",
      })).toThrow(BrokerError);
    });

    it("rejects missing reason (required)", () => {
      expect(() => broker.validateArgs("x402.pay", {
        url: "https://example.com", maxAmountUsdc: "0.01",
      })).toThrow(BrokerError);
    });

    it("accepts missing method (optional, has default)", () => {
      expect(() => broker.validateArgs("x402.pay", {
        url: "https://example.com", maxAmountUsdc: "0.01", reason: "test",
      })).not.toThrow();
    });

    it("accepts missing idempotencyKey (optional)", () => {
      expect(() => broker.validateArgs("x402.pay", {
        url: "https://example.com", maxAmountUsdc: "0.01", reason: "test",
      })).not.toThrow();
    });

    it("accepts missing body (optional)", () => {
      expect(() => broker.validateArgs("x402.pay", {
        url: "https://example.com", maxAmountUsdc: "0.01", reason: "test",
      })).not.toThrow();
    });
  });

  // erc8183.create_job: provider, evaluator, expiredAt, description required; hook optional
  describe("erc8183.create_job", () => {
    const VALID = {
      provider: "0x1234567890123456789012345678901234567890",
      evaluator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      expiredAt: "9999999999",
      description: "test",
    };

    it("rejects missing provider (required)", () => {
      const { provider, ...rest } = VALID;
      expect(() => broker.validateArgs("erc8183.create_job", rest)).toThrow(BrokerError);
    });

    it("rejects missing evaluator (required)", () => {
      const { evaluator, ...rest } = VALID;
      expect(() => broker.validateArgs("erc8183.create_job", rest)).toThrow(BrokerError);
    });

    it("rejects missing expiredAt (required)", () => {
      const { expiredAt, ...rest } = VALID;
      expect(() => broker.validateArgs("erc8183.create_job", rest)).toThrow(BrokerError);
    });

    it("rejects missing description (required)", () => {
      const { description, ...rest } = VALID;
      expect(() => broker.validateArgs("erc8183.create_job", rest)).toThrow(BrokerError);
    });

    it("accepts missing hook (optional)", () => {
      expect(() => broker.validateArgs("erc8183.create_job", VALID)).not.toThrow();
    });
  });

  // erc8183.set_budget: jobId, amount required; optParams optional
  describe("erc8183.set_budget", () => {
    it("rejects missing jobId (required)", () => {
      expect(() => broker.validateArgs("erc8183.set_budget", {
        amount: "1.0",
      })).toThrow(BrokerError);
    });

    it("rejects missing amount (required)", () => {
      expect(() => broker.validateArgs("erc8183.set_budget", {
        jobId: "1",
      })).toThrow(BrokerError);
    });

    it("accepts missing optParams (optional)", () => {
      expect(() => broker.validateArgs("erc8183.set_budget", {
        jobId: "1", amount: "1.0",
      })).not.toThrow();
    });
  });

  // circle.gateway_deposit: amount required; method optional
  describe("circle.gateway_deposit", () => {
    it("rejects missing amount (required)", () => {
      expect(() => broker.validateArgs("circle.gateway_deposit", {})).toThrow(BrokerError);
    });

    it("accepts missing method (optional)", () => {
      expect(() => broker.validateArgs("circle.gateway_deposit", {
        amount: "1.0",
      })).not.toThrow();
    });
  });
});

// ── 3. Defaulted Fields ─────────────────────────────────────────────────

describe("3. Defaulted Fields", () => {
  it("x402.pay defaults method to GET", () => {
    const result = safeValidateMcpToolInput("x402.pay", {
      url: "https://example.com", maxAmountUsdc: "0.01", reason: "test",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect((result.data as Record<string, unknown>).method).toBe("GET");
  });

  it("x402.inspect defaults method to GET", () => {
    const result = safeValidateMcpToolInput("x402.inspect", {
      url: "https://example.com",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect((result.data as Record<string, unknown>).method).toBe("GET");
  });

  it("x402.batch_pay defaults method to GET for each payment", () => {
    const result = safeValidateMcpToolInput("x402.batch_pay", {
      batchId: "b1", taskId: "t1",
      payments: [
        { url: "https://a.com", maxAmountUsdc: "0.01", reason: "r1" },
        { url: "https://b.com", method: "POST", maxAmountUsdc: "0.02", reason: "r2" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const data = result.data as Record<string, unknown>;
    const payments = data.payments as Array<Record<string, unknown>>;
    expect(payments[0].method).toBe("GET");
    expect(payments[1].method).toBe("POST");
  });

  it("x402.pay preserves explicit method", () => {
    const result = safeValidateMcpToolInput("x402.pay", {
      url: "https://example.com", method: "POST", maxAmountUsdc: "0.01", reason: "test",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect((result.data as Record<string, unknown>).method).toBe("POST");
  });
});

// ── 4. Enum Constraints ─────────────────────────────────────────────────

describe("4. Enum Constraints", () => {
  const broker = new McpToolBroker();

  describe("HTTP method enum (x402.pay)", () => {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      it(`accepts method="${method}"`, () => {
        expect(() => broker.validateArgs("x402.pay", {
          url: "https://example.com", method, maxAmountUsdc: "0.01", reason: "test",
        })).not.toThrow();
      });
    }

    it("rejects method=PATCHY (invalid enum)", () => {
      expect(() => broker.validateArgs("x402.pay", {
        url: "https://example.com", method: "PATCHY", maxAmountUsdc: "0.01", reason: "test",
      })).toThrow(BrokerError);
    });

    it("rejects method=OPTIONS (invalid enum)", () => {
      expect(() => broker.validateArgs("x402.pay", {
        url: "https://example.com", method: "OPTIONS", maxAmountUsdc: "0.01", reason: "test",
      })).toThrow(BrokerError);
    });
  });

  describe("gateway deposit method enum", () => {
    it("accepts method=eco", () => {
      expect(() => broker.validateArgs("circle.gateway_deposit", {
        amount: "1.0", method: "eco",
      })).not.toThrow();
    });

    it("accepts method=direct", () => {
      expect(() => broker.validateArgs("circle.gateway_deposit", {
        amount: "1.0", method: "direct",
      })).not.toThrow();
    });

    it("rejects method=fast (invalid enum)", () => {
      expect(() => broker.validateArgs("circle.gateway_deposit", {
        amount: "1.0", method: "fast",
      })).toThrow(BrokerError);
    });
  });
});

// ── 5. Regex Constraints ────────────────────────────────────────────────

describe("5. Regex Constraints", () => {
  const broker = new McpToolBroker();

  describe("Ethereum address regex (0x + 40 hex)", () => {
    const VALID_ADDR = "0x1234567890123456789012345678901234567890";

    it("accepts valid 0x + 40 hex address", () => {
      expect(() => broker.validateArgs("erc8183.create_job", {
        provider: VALID_ADDR, evaluator: VALID_ADDR,
        expiredAt: "9999999999", description: "test",
      })).not.toThrow();
    });

    it("rejects address without 0x prefix", () => {
      expect(() => broker.validateArgs("erc8183.create_job", {
        provider: "1234567890123456789012345678901234567890",
        evaluator: VALID_ADDR, expiredAt: "9999999999", description: "test",
      })).toThrow(BrokerError);
    });

    it("rejects address with 38 hex chars (too short)", () => {
      expect(() => broker.validateArgs("erc8183.create_job", {
        provider: "0x12345678901234567890123456789012345678",
        evaluator: VALID_ADDR, expiredAt: "9999999999", description: "test",
      })).toThrow(BrokerError);
    });

    it("rejects address with 42 hex chars (too long)", () => {
      expect(() => broker.validateArgs("erc8183.create_job", {
        provider: "0x123456789012345678901234567890123456789012",
        evaluator: VALID_ADDR, expiredAt: "9999999999", description: "test",
      })).toThrow(BrokerError);
    });

    it("rejects address with non-hex chars", () => {
      expect(() => broker.validateArgs("erc8183.create_job", {
        provider: "0xGHIJ567890123456789012345678901234567890",
        evaluator: VALID_ADDR, expiredAt: "9999999999", description: "test",
      })).toThrow(BrokerError);
    });
  });

  describe("Numeric string regex (jobId)", () => {
    it("accepts numeric string jobId", () => {
      expect(() => broker.validateArgs("erc8183.claim_refund", {
        jobId: "42",
      })).not.toThrow();
    });

    it("accepts large numeric string jobId", () => {
      expect(() => broker.validateArgs("erc8183.claim_refund", {
        jobId: "12345678901234567890",
      })).not.toThrow();
    });

    it("rejects alphanumeric jobId", () => {
      expect(() => broker.validateArgs("erc8183.claim_refund", {
        jobId: "abc123",
      })).toThrow(BrokerError);
    });

    it("rejects empty string jobId", () => {
      expect(() => broker.validateArgs("erc8183.claim_refund", {
        jobId: "",
      })).toThrow(BrokerError);
    });
  });

  describe("Decimal amount regex", () => {
    it("accepts integer amount", () => {
      expect(() => broker.validateArgs("erc8183.set_budget", {
        jobId: "1", amount: "100",
      })).not.toThrow();
    });

    it("accepts decimal amount", () => {
      expect(() => broker.validateArgs("erc8183.set_budget", {
        jobId: "1", amount: "0.01",
      })).not.toThrow();
    });

    it("accepts amount with many decimals", () => {
      expect(() => broker.validateArgs("erc8183.set_budget", {
        jobId: "1", amount: "123.456789",
      })).not.toThrow();
    });

    it("rejects amount with leading dot", () => {
      expect(() => broker.validateArgs("erc8183.set_budget", {
        jobId: "1", amount: ".5",
      })).toThrow(BrokerError);
    });

    it("rejects amount with letters", () => {
      expect(() => broker.validateArgs("erc8183.set_budget", {
        jobId: "1", amount: "1.0abc",
      })).toThrow(BrokerError);
    });

    it("rejects negative amount", () => {
      expect(() => broker.validateArgs("erc8183.set_budget", {
        jobId: "1", amount: "-1.0",
      })).toThrow(BrokerError);
    });
  });

  describe("Bytes32 / deliverableHash regex", () => {
    const VALID_HASH = "0x" + "a".repeat(64);

    it("accepts 0x-prefixed 64 hex chars", () => {
      expect(() => broker.validateArgs("erc8183.provider_submit_deliverable", {
        jobId: "1", deliverableHash: VALID_HASH,
      })).not.toThrow();
    });

    it("accepts bare 64 hex chars (backward compat)", () => {
      expect(() => broker.validateArgs("erc8183.provider_submit_deliverable", {
        jobId: "1", deliverableHash: "a".repeat(64),
      })).not.toThrow();
    });

    it("rejects 62 hex chars (too short)", () => {
      expect(() => broker.validateArgs("erc8183.provider_submit_deliverable", {
        jobId: "1", deliverableHash: "0x" + "a".repeat(62),
      })).toThrow(BrokerError);
    });

    it("rejects 66 hex chars (too long)", () => {
      expect(() => broker.validateArgs("erc8183.provider_submit_deliverable", {
        jobId: "1", deliverableHash: "0x" + "a".repeat(66),
      })).toThrow(BrokerError);
    });

    it("rejects non-hex chars in hash", () => {
      expect(() => broker.validateArgs("erc8183.provider_submit_deliverable", {
        jobId: "1", deliverableHash: "0x" + "g".repeat(64),
      })).toThrow(BrokerError);
    });

    it("rejects empty string", () => {
      expect(() => broker.validateArgs("erc8183.provider_submit_deliverable", {
        jobId: "1", deliverableHash: "",
      })).toThrow(BrokerError);
    });
  });

  describe("URL validation", () => {
    it("accepts https URL", () => {
      expect(() => broker.validateArgs("x402.inspect", {
        url: "https://example.com/path",
      })).not.toThrow();
    });

    it("rejects bare hostname", () => {
      expect(() => broker.validateArgs("x402.inspect", {
        url: "example.com",
      })).toThrow(BrokerError);
    });

    it("rejects empty string URL", () => {
      expect(() => broker.validateArgs("x402.inspect", {
        url: "",
      })).toThrow(BrokerError);
    });
  });
});

// ── 6. Broker vs validateMcpToolInput Parity ────────────────────────────

describe("6. Broker vs validateMcpToolInput Parity", () => {
  /**
   * When the broker rejects an input, validateMcpToolInput should also reject it.
   * Both use the same Zod schema — this proves the validation path is unified.
   */

  const INVALID_CASES: Array<{
    tool: string;
    args: Record<string, unknown>;
    label: string;
  }> = [
    { tool: "x402.pay", args: { url: "not-a-url", maxAmountUsdc: "0.01", reason: "test" }, label: "invalid url" },
    { tool: "x402.pay", args: { url: "https://a.com", maxAmountUsdc: "abc", reason: "test" }, label: "non-numeric amount" },
    { tool: "x402.pay", args: { url: "https://a.com", maxAmountUsdc: "0.01", reason: "" }, label: "empty reason" },
    { tool: "x402.batch_pay", args: { batchId: "b1", taskId: "t1", payments: [] }, label: "empty payments array" },
    { tool: "erc8183.create_job", args: { provider: "bad", evaluator: "0x1234567890123456789012345678901234567890", expiredAt: "1", description: "x" }, label: "invalid provider" },
    { tool: "erc8183.create_job", args: { provider: "0x1234567890123456789012345678901234567890", evaluator: "bad", expiredAt: "1", description: "x" }, label: "invalid evaluator" },
    { tool: "erc8183.provider_submit_deliverable", args: { jobId: "1", deliverableHash: "not-hex" }, label: "invalid hash" },
    { tool: "erc8183.claim_refund", args: { jobId: "abc" }, label: "non-numeric jobId" },
    { tool: "circle.gateway_deposit", args: { amount: "-1" }, label: "negative amount" },
    { tool: "circle.gateway_deposit", args: { amount: "1", method: "invalid" }, label: "invalid method" },
  ];

  for (const { tool, args, label } of INVALID_CASES) {
    it(`broker rejects: ${tool} — ${label}`, () => {
      const broker = new McpToolBroker();
      expect(() => broker.validateArgs(tool, args)).toThrow(BrokerError);
    });

    it(`validateMcpToolInput rejects: ${tool} — ${label}`, () => {
      const result = safeValidateMcpToolInput(tool, args);
      expect(result.ok).toBe(false);
    });
  }

  /**
   * When both accept, the parsed data should be equivalent.
   */
  const VALID_CASES: Array<{
    tool: string;
    args: Record<string, unknown>;
    label: string;
  }> = [
    { tool: "x402.pay", args: { url: "https://a.com", maxAmountUsdc: "0.01", reason: "test" }, label: "minimal valid" },
    { tool: "x402.pay", args: { url: "https://a.com", method: "POST", maxAmountUsdc: "5.00", reason: "x", body: { k: "v" } }, label: "full valid" },
    { tool: "erc8183.claim_refund", args: { jobId: "42" }, label: "single field" },
    { tool: "erc8183.provider_submit_deliverable", args: { jobId: "1", deliverableHash: "a".repeat(64) }, label: "bare hex hash" },
    { tool: "circle.gateway_deposit", args: { amount: "10.5", method: "direct" }, label: "with method" },
  ];

  for (const { tool, args, label } of VALID_CASES) {
    it(`broker accepts: ${tool} — ${label}`, () => {
      const broker = new McpToolBroker();
      expect(() => broker.validateArgs(tool, args)).not.toThrow();
    });

    it(`validateMcpToolInput accepts: ${tool} — ${label}`, () => {
      const result = safeValidateMcpToolInput(tool, args);
      expect(result.ok).toBe(true);
    });
  }
});

// ── 7. Valid Payloads Parse Into Normalized Shape ────────────────────────

describe("7. Valid Payloads Parse Into Normalized Shape", () => {
  /** Helper: assert ok and return data */
  function expectValid(result: ReturnType<typeof safeValidateMcpToolInput>): Record<string, unknown> {
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    return result.data as Record<string, unknown>;
  }

  it("x402.pay applies method default and preserves all fields", () => {
    const data = expectValid(safeValidateMcpToolInput("x402.pay", {
      url: "https://example.com/pay",
      maxAmountUsdc: "0.05",
      reason: "oracle access",
      idempotencyKey: "key-123",
      body: { query: "BTC/USD" },
    }));
    expect(data.url).toBe("https://example.com/pay");
    expect(data.method).toBe("GET");
    expect(data.maxAmountUsdc).toBe("0.05");
    expect(data.reason).toBe("oracle access");
    expect(data.idempotencyKey).toBe("key-123");
    expect(data.body).toEqual({ query: "BTC/USD" });
  });

  it("x402.batch_pay applies method default per payment", () => {
    const data = expectValid(safeValidateMcpToolInput("x402.batch_pay", {
      batchId: "b1", taskId: "t1",
      payments: [
        { url: "https://a.com", maxAmountUsdc: "0.01", reason: "r1" },
        { url: "https://b.com", method: "DELETE", maxAmountUsdc: "0.02", reason: "r2" },
      ],
    }));
    const payments = data.payments as Array<Record<string, unknown>>;
    expect(payments[0].method).toBe("GET");
    expect(payments[1].method).toBe("DELETE");
  });

  it("erc8183.create_job preserves all fields", () => {
    const data = expectValid(safeValidateMcpToolInput("erc8183.create_job", {
      provider: "0x1234567890123456789012345678901234567890",
      evaluator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      expiredAt: "9999999999",
      description: "test job",
      hook: "0x9876543210987654321098765432109876543210",
    }));
    expect(data.provider).toBe("0x1234567890123456789012345678901234567890");
    expect(data.evaluator).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(data.expiredAt).toBe("9999999999");
    expect(data.description).toBe("test job");
    expect(data.hook).toBe("0x9876543210987654321098765432109876543210");
  });

  it("erc8183.provider_submit_deliverable accepts bare hex and passes through", () => {
    const data = expectValid(safeValidateMcpToolInput(
      "erc8183.provider_submit_deliverable",
      { jobId: "42", deliverableHash: "a".repeat(64) }
    ));
    expect(data.jobId).toBe("42");
    // Schema passes bare hex through — handler normalizes to 0x prefix
    expect(data.deliverableHash).toBe("a".repeat(64));
  });

  it("erc8183.provider_submit_deliverable accepts 0x-prefixed hash", () => {
    const data = expectValid(safeValidateMcpToolInput(
      "erc8183.provider_submit_deliverable",
      { jobId: "42", deliverableHash: "0x" + "b".repeat(64) }
    ));
    expect(data.deliverableHash).toBe("0x" + "b".repeat(64));
  });

  it("circle.gateway_deposit preserves explicit method", () => {
    const data = expectValid(safeValidateMcpToolInput("circle.gateway_deposit", {
      amount: "2.5", method: "eco",
    }));
    expect(data.amount).toBe("2.5");
    expect(data.method).toBe("eco");
  });
});

// ── 8. safeValidateMcpToolInput Never Throws ────────────────────────────

describe("8. safeValidateMcpToolInput Never Throws", () => {
  it("returns ok:false for completely wrong types", () => {
    const result = safeValidateMcpToolInput("x402.pay", {
      url: 123, maxAmountUsdc: null, reason: undefined,
    });
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for missing all required fields", () => {
    const result = safeValidateMcpToolInput("erc8183.create_job", {});
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for empty object on required-fields tool", () => {
    const result = safeValidateMcpToolInput("x402.batch_pay", {});
    expect(result.ok).toBe(false);
  });

  it("returns ok:true for unknown tools (no schema = pass-through)", () => {
    const result = safeValidateMcpToolInput("unknown.tool", { anything: "goes" });
    expect(result.ok).toBe(true);
  });

  it("returns ok:true for read-only tools without Zod schemas", () => {
    const result = safeValidateMcpToolInput("runner.health", {});
    expect(result.ok).toBe(true);
  });
});

// ── 9. Provider Input Required (not undefined) ──────────────────────────

describe("9. Provider job input must not be undefined", () => {
  const VALID_PROVIDER_JOB = {
    taskId: "t1",
    jobId: "42",
    agentId: "agent-1",
    provider: "0x1234567890123456789012345678901234567890",
    description: "test job",
    input: { prompt: "hello" },
  };

  it("erc8183.provider_run_job accepts valid input with JSON payload", () => {
    const result = safeValidateMcpToolInput("erc8183.provider_run_job", VALID_PROVIDER_JOB);
    expect(result.ok).toBe(true);
  });

  it("erc8183.provider_run_job accepts input=0 (falsy but defined)", () => {
    const result = safeValidateMcpToolInput("erc8183.provider_run_job", {
      ...VALID_PROVIDER_JOB, input: 0,
    });
    expect(result.ok).toBe(true);
  });

  it("erc8183.provider_run_job accepts input=false (falsy but defined)", () => {
    const result = safeValidateMcpToolInput("erc8183.provider_run_job", {
      ...VALID_PROVIDER_JOB, input: false,
    });
    expect(result.ok).toBe(true);
  });

  it("erc8183.provider_run_job accepts input=null (defined)", () => {
    const result = safeValidateMcpToolInput("erc8183.provider_run_job", {
      ...VALID_PROVIDER_JOB, input: null,
    });
    expect(result.ok).toBe(true);
  });

  it("erc8183.provider_run_job accepts input=[] (empty array)", () => {
    const result = safeValidateMcpToolInput("erc8183.provider_run_job", {
      ...VALID_PROVIDER_JOB, input: [],
    });
    expect(result.ok).toBe(true);
  });

  it("erc8183.provider_run_job rejects missing input (undefined)", () => {
    const { input, ...withoutInput } = VALID_PROVIDER_JOB;
    const result = safeValidateMcpToolInput("erc8183.provider_run_job", withoutInput);
    expect(result.ok).toBe(false);
  });

  it("erc8183.provider_run_and_submit rejects missing input (undefined)", () => {
    const { input, ...withoutInput } = VALID_PROVIDER_JOB;
    const result = safeValidateMcpToolInput("erc8183.provider_run_and_submit", withoutInput);
    expect(result.ok).toBe(false);
  });
});

// ── 10. Required Fields Emitted in tools/list ────────────────────────────

describe("10. Required fields emitted in generated tool schemas", () => {
  it("x402.pay inputSchema marks url, maxAmountUsdc, reason as required", () => {
    const toolDef = RUNNER_MCP_TOOLS.find((t) => t.name === "x402.pay")!;
    const schema = toolDef.inputSchema as Record<string, Record<string, unknown>>;
    expect(schema.url.required).toBe(true);
    expect(schema.maxAmountUsdc.required).toBe(true);
    expect(schema.reason.required).toBe(true);
  });

  it("x402.pay inputSchema does NOT mark method, idempotencyKey, body as required", () => {
    const toolDef = RUNNER_MCP_TOOLS.find((t) => t.name === "x402.pay")!;
    const schema = toolDef.inputSchema as Record<string, Record<string, unknown>>;
    expect(schema.method?.required).toBeUndefined();
    expect(schema.idempotencyKey?.required).toBeUndefined();
    expect(schema.body?.required).toBeUndefined();
  });

  it("erc8183.create_job marks provider, evaluator, expiredAt, description as required", () => {
    const toolDef = RUNNER_MCP_TOOLS.find((t) => t.name === "erc8183.create_job")!;
    const schema = toolDef.inputSchema as Record<string, Record<string, unknown>>;
    expect(schema.provider.required).toBe(true);
    expect(schema.evaluator.required).toBe(true);
    expect(schema.expiredAt.required).toBe(true);
    expect(schema.description.required).toBe(true);
  });

  it("erc8183.create_job does NOT mark hook as required", () => {
    const toolDef = RUNNER_MCP_TOOLS.find((t) => t.name === "erc8183.create_job")!;
    const schema = toolDef.inputSchema as Record<string, Record<string, unknown>>;
    expect(schema.hook?.required).toBeUndefined();
  });

  it("erc8183.provider_run_job marks input as required", () => {
    const toolDef = RUNNER_MCP_TOOLS.find((t) => t.name === "erc8183.provider_run_job")!;
    const schema = toolDef.inputSchema as Record<string, Record<string, unknown>>;
    expect(schema.input.required).toBe(true);
  });

  it("circle.gateway_deposit marks amount as required, method as optional", () => {
    const toolDef = RUNNER_MCP_TOOLS.find((t) => t.name === "circle.gateway_deposit")!;
    const schema = toolDef.inputSchema as Record<string, Record<string, unknown>>;
    expect(schema.amount.required).toBe(true);
    expect(schema.method?.required).toBeUndefined();
  });
});
