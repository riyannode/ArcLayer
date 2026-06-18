import { describe, it, expect, vi } from "vitest";

// Mock the circle-dev-wallet-adapter module BEFORE importing the factory
vi.mock("@arclayer/circle-dev-wallet-adapter", () => {
  return {
    CircleDevWalletAdapter: class MockCircleDevWalletAdapter {
      readonly _mockBrand = "circle-dev";
      constructor(public opts: unknown) {}
    },
  };
});

// Import AFTER mock is set up
import { createWalletAdapter } from "../wallet-adapter-factory";

describe("createWalletAdapter", () => {
  const baseConfig = {
    runnerId: "test-runner",
    agentId: "test-agent",
    agentAddress: "0x1234567890123456789012345678901234567890" as `0x${string}`,
    runtimeKind: "hermes" as const,
    runtimeEndpoint: "http://localhost:8787",
    runtimeRunPath: "/run",
    runtimeTimeoutMs: 120000,
    defaultRole: "provider" as const,
    allowedRoles: ["provider" as const],
    chain: "ARC-TESTNET",
    circleCliBin: "circle",
    circleWalletAddress: "0x1234567890123456789012345678901234567890" as `0x${string}`,
    walletRail: "circle-dev" as const,
    circleApiKey: "test-api-key",
    circleEntitySecret: "test-entity-secret",
    circleWalletId: "test-wallet-id",
    paymentEnabled: false,
    perTxLimitUsdc: "0.01",
    dailyLimitUsdc: "1",
    monthlyLimitUsdc: "20",
    batchMaxItems: 10,
    batchMaxTotalUsdc: "0.05",
    allowedX402Hosts: [],
    allowGatewayDeposit: false,
    allowIdentityRegister: false,
    toolBrokerEnabled: true,
    toolMaxCalls: 500,
    toolMaxTotalUsdc: "10",
    toolDefaultTimeoutMs: 30000,
    toolMaxOutputBytes: 1048576,
    dataDir: ".test-data",
    port: 8787,
    host: "127.0.0.1",
    runnerSecret: "test-runner-secret-long-enough",
  };

  it("returns CircleDevWalletAdapter by default", () => {
    const adapter = createWalletAdapter(baseConfig);
    expect((adapter as any)._mockBrand).toBe("circle-dev");
  });

  it("returns CircleDevWalletAdapter when walletRail is circle-dev", () => {
    const adapter = createWalletAdapter(baseConfig);
    expect((adapter as any)._mockBrand).toBe("circle-dev");
  });

  it("throws for unsupported walletRail", () => {
    expect(() =>
      createWalletAdapter({ ...baseConfig, walletRail: "unsupported" as any })
    ).toThrow("Unsupported wallet rail");
  });

  it("throws when circle-dev rail is missing required config", () => {
    expect(() =>
      createWalletAdapter({
        ...baseConfig,
        circleApiKey: undefined,
        circleEntitySecret: undefined,
        circleWalletId: undefined,
      })
    ).toThrow("circle-dev wallet rail requires");
  });
});
