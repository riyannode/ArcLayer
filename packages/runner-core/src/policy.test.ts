import { describe, it, expect } from "vitest";
import {
  assertRoleAllowed,
  assertProviderOnlyForExternal,
  assertAgentIdentity,
  assertX402InspectAllowed,
  assertX402PaymentAllowed,
  assertBatchAllowed,
  decimalToMicros
} from "./policy";
import { RunnerError } from "./errors";
import type { RunnerConfig, PaymentRequest } from "./types";

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
    dataDir: ".test-runner",
    port: 8787,
    runnerSecret: "test-secret-at-least-16-chars",
    ...overrides
  };
}

function makePayment(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    type: "x402_service_pay",
    url: "https://api.example.com/weather",
    method: "GET",
    maxAmountUsdc: "0.005",
    reason: "test payment",
    ...overrides
  };
}

function expectRunnerError(fn: () => void, code: string) {
  try {
    fn();
    expect.fail(`Expected RunnerError with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RunnerError);
    expect((error as RunnerError).code).toBe(code);
  }
}

describe("decimalToMicros", () => {
  it("converts whole numbers", () => {
    expect(decimalToMicros("1")).toBe(1_000_000n);
  });

  it("converts decimals", () => {
    expect(decimalToMicros("0.01")).toBe(10_000n);
  });

  it("converts mixed", () => {
    expect(decimalToMicros("1.5")).toBe(1_500_000n);
  });

  it("handles zero", () => {
    expect(decimalToMicros("0")).toBe(0n);
  });
});

describe("assertRoleAllowed", () => {
  it("allows provider role", () => {
    expect(() => assertRoleAllowed(makeConfig(), "provider")).not.toThrow();
  });

  it("rejects evaluator for provider-only runner", () => {
    expectRunnerError(() => assertRoleAllowed(makeConfig(), "evaluator"), "ROLE_NOT_ALLOWED");
  });

  it("rejects client for provider-only runner", () => {
    expectRunnerError(() => assertRoleAllowed(makeConfig(), "client"), "ROLE_NOT_ALLOWED");
  });
});

describe("assertProviderOnlyForExternal (deprecated no-op)", () => {
  it("allows provider for provider-default runner", () => {
    expect(() => assertProviderOnlyForExternal(makeConfig(), "provider")).not.toThrow();
  });

  it("allows evaluator for provider-default runner (no-op)", () => {
    expect(() => assertProviderOnlyForExternal(makeConfig(), "evaluator")).not.toThrow();
  });
});

describe("assertAgentIdentity", () => {
  it("passes for matching agentId", () => {
    expect(() => assertAgentIdentity(makeConfig(), "agent-1")).not.toThrow();
  });

  it("rejects mismatched agentId", () => {
    expectRunnerError(() => assertAgentIdentity(makeConfig(), "agent-2"), "AGENT_ID_MISMATCH");
  });
});

describe("assertX402InspectAllowed", () => {
  it("passes for allowed host", () => {
    expect(() => assertX402InspectAllowed(makeConfig(), makePayment())).not.toThrow();
  });

  it("rejects unallowlisted host", () => {
    expectRunnerError(
      () => assertX402InspectAllowed(makeConfig(), makePayment({ url: "https://evil.com/api" })),
      "X402_HOST_NOT_ALLOWED"
    );
  });

  it("allows any host when wildcard * is configured", () => {
    expect(() =>
      assertX402InspectAllowed(
        makeConfig({ allowedX402Hosts: ["*"] }),
        makePayment({ url: "https://any-host.example.com/api" })
      )
    ).not.toThrow();
  });

  it("passes even when payment disabled (inspect is read-only)", () => {
    expect(() =>
      assertX402InspectAllowed(makeConfig({ paymentEnabled: false }), makePayment())
    ).not.toThrow();
  });

  it("passes even when no wallet configured (inspect is read-only)", () => {
    expect(() =>
      assertX402InspectAllowed(makeConfig({ circleWalletAddress: undefined }), makePayment())
    ).not.toThrow();
  });
});

describe("assertX402PaymentAllowed", () => {
  it("passes for allowed payment", () => {
    expect(() => assertX402PaymentAllowed(makeConfig(), makePayment())).not.toThrow();
  });

  it("rejects when payments disabled", () => {
    expectRunnerError(
      () => assertX402PaymentAllowed(makeConfig({ paymentEnabled: false }), makePayment()),
      "PAYMENT_DISABLED"
    );
  });

  it("rejects when no wallet configured", () => {
    expectRunnerError(
      () => assertX402PaymentAllowed(makeConfig({ circleWalletAddress: undefined }), makePayment()),
      "CIRCLE_WALLET_MISSING"
    );
  });

  it("rejects unallowlisted host", () => {
    expectRunnerError(
      () => assertX402PaymentAllowed(makeConfig(), makePayment({ url: "https://evil.com/api" })),
      "X402_HOST_NOT_ALLOWED"
    );
  });

  it("rejects amount exceeding per-tx limit", () => {
    expectRunnerError(
      () => assertX402PaymentAllowed(makeConfig(), makePayment({ maxAmountUsdc: "1.0" })),
      "PER_TX_LIMIT_EXCEEDED"
    );
  });
});

describe("assertBatchAllowed", () => {
  it("passes for valid batch", () => {
    expect(() =>
      assertBatchAllowed(makeConfig(), [makePayment(), makePayment()])
    ).not.toThrow();
  });

  it("rejects batch exceeding max items", () => {
    const payments = Array.from({ length: 11 }, () => makePayment());
    expectRunnerError(() => assertBatchAllowed(makeConfig(), payments), "BATCH_MAX_ITEMS_EXCEEDED");
  });

  it("rejects batch exceeding max total", () => {
    const payments = Array.from({ length: 8 }, () => makePayment({ maxAmountUsdc: "0.008" }));
    expectRunnerError(() => assertBatchAllowed(makeConfig(), payments), "BATCH_MAX_TOTAL_EXCEEDED");
  });
});
