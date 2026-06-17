import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWalletAdapter } from "../wallet-adapter-factory";
import { CircleCliAdapter } from "@arclayer/circle-cli-adapter";

// Mock the circle-dev-wallet-adapter module
vi.mock("@arclayer/circle-dev-wallet-adapter", () => ({
  CircleDevWalletAdapter: class MockCircleDevWalletAdapter {
    constructor(public opts: unknown) {}
  },
}));

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
    walletRail: "circle-cli" as const,
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

  it("returns CircleCliAdapter by default (walletRail=circle-cli)", () => {
    const adapter = createWalletAdapter(baseConfig);
    expect(adapter).toBeInstanceOf(CircleCliAdapter);
  });

  it("returns CircleCliAdapter when walletRail is explicitly circle-cli", () => {
    const adapter = createWalletAdapter({ ...baseConfig, walletRail: "circle-cli" });
    expect(adapter).toBeInstanceOf(CircleCliAdapter);
  });

  it("returns CircleDevWalletAdapter when walletRail is circle-dev", () => {
    const { CircleDevWalletAdapter } = require("@arclayer/circle-dev-wallet-adapter");
    const adapter = createWalletAdapter({
      ...baseConfig,
      walletRail: "circle-dev",
      circleApiKey: "test-key",
      circleEntitySecret: "test-secret",
      circleWalletId: "test-wallet-id",
    });
    expect(adapter).toBeInstanceOf(CircleDevWalletAdapter);
  });

  it("throws when circle-dev rail is missing required config", () => {
    expect(() =>
      createWalletAdapter({
        ...baseConfig,
        walletRail: "circle-dev",
        // missing circleApiKey, circleEntitySecret, circleWalletId
      })
    ).toThrow("circle-dev wallet rail requires");
  });
});
