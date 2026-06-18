/**
 * Provider worker tests.
 *
 * Verifies:
 *   - setBudget passes decimal amount, not atomic double-converted amount
 *   - identity verification checks
 *   - deprecated CLI alias warning
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProviderWorker, type ProviderWorkerConfig } from "./provider";
import type { RunnerConfig } from "@arclayer/runner-core";

// ── Mocks ───────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<RunnerConfig>): RunnerConfig {
  return {
    agentId: "agent-test",
    defaultRole: "provider",
    allowedRoles: ["provider"],
    runnerId: "runner-test",
    agentAddress: "0x0000000000000000000000000000000000000000",
    chain: "ARC-TESTNET",
    circleWalletAddress: "0x1234567890123456789012345678901234567890",
    walletRail: "circle-dev",
    circleApiKey: "test-key",
    circleEntitySecret: "test-secret",
    circleWalletSetId: "test-set",
    circleWalletId: "test-wallet",
    runtimeKind: "custom",
    runtimeEndpoint: "http://127.0.0.1:8788",
    runtimeRunPath: "/run",
    runtimeTimeoutMs: 120000,
    port: 8787,
    host: "127.0.0.1",
    runnerSecret: "test-secret-at-least-16-chars",
    paymentEnabled: false,
    allowIdentityRegister: true,
    allowGatewayDeposit: false,
    toolBrokerEnabled: false,
    toolMaxTotalUsdc: "10",
    toolMaxCalls: 500,
    toolDefaultTimeoutMs: 30000,
    toolMaxOutputBytes: 1048576,
    dataDir: ".test-arclayer",
    ...overrides,
  } as RunnerConfig;
}

function makeServices() {
  return {
    setBudget: vi.fn().mockResolvedValue({ ok: true, txHash: "0xabc" }),
    runProviderJob: vi.fn().mockResolvedValue({
      ok: true,
      status: "completed",
      result: { ok: true, status: "completed", output: "test output", artifacts: [] },
    }),
    submitProviderDeliverable: vi.fn().mockResolvedValue({ ok: true, txHash: "0xdef" }),
    circleStatus: vi.fn().mockResolvedValue({ ok: true }),
    listReconcilableOperations: vi.fn().mockReturnValue([]),
    reconcileOperation: vi.fn(),
  };
}

function makeMcp() {
  return {
    callTool: vi.fn().mockResolvedValue({
      ok: true,
      jobs: [],
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRuntime() {
  return {
    kind: "custom",
    run: vi.fn().mockResolvedValue({
      ok: true,
      status: "completed",
      output: "test",
      artifacts: [],
    }),
    healthCheck: vi.fn().mockResolvedValue({ ok: true }),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ProviderWorker", () => {
  beforeEach(() => {
    process.env.ARCLAYER_MCP_TOKEN = "test-mcp-token-for-testing";
  });

  describe("setBudget amount", () => {
    it("passes decimal amount to services.setBudget, not atomic", async () => {
      const config = makeConfig();
      const services = makeServices();
      const mcp = makeMcp();
      const runtime = makeRuntime();

      // Mock MCP to return an Open job with proposed budget
      // Call sequence: verifyIdentity → pollFundedJobs → pollOpenJobs → verifyBudget
      mcp.callTool = vi.fn()
        // identity.get_agent_account (verifyIdentity)
        .mockResolvedValueOnce({ ok: true, tokenId: "42" })
        // provider.list_assigned_jobs_extended (pollFundedJobs — empty)
        .mockResolvedValueOnce({ jobs: [] })
        // provider.list_assigned_jobs_extended (pollOpenJobs)
        .mockResolvedValueOnce({
          jobs: [
            {
              id: "local-1",
              erc8183JobId: "100",
              providerAddress: config.circleWalletAddress,
              description: JSON.stringify({
                schema: "arclayer.job",
                version: 1,
                task: "Test provider task",
                acceptanceCriteria: [{ id: "ac-1", description: "Must produce output", mandatory: true }],
                commercialTerms: {
                  proposedBudgetUsdc: "1.00",
                  clientWillFund: true,
                },
              }),
              status: "Open",
            },
          ],
        })
        // jobs.get_onchain_status (verification after setBudget)
        .mockResolvedValueOnce({
          ok: true,
          budgetAtomic: "1000000",
          provider: config.circleWalletAddress,
        });

      const worker = createProviderWorker(config, services as any, mcp as any, runtime as any);

      await worker.runOnce();

      // Verify setBudget was called with decimal "1.00", NOT atomic "1000000"
      expect(services.setBudget).toHaveBeenCalledTimes(1);
      const callArg = services.setBudget.mock.calls[0][0];
      expect(callArg.amount).toBe("1.00");
      expect(callArg.amount).not.toBe("1000000");
      expect(callArg.jobId).toBe("100");
    });

    it("passes decimal amount from priceAtomic field", async () => {
      const config = makeConfig();
      const services = makeServices();
      const mcp = makeMcp();
      const runtime = makeRuntime();

      mcp.callTool = vi.fn()
        .mockResolvedValueOnce({ ok: true, tokenId: "42" })
        // provider.list_assigned_jobs_extended (pollFundedJobs — empty)
        .mockResolvedValueOnce({ jobs: [] })
        .mockResolvedValueOnce({
          jobs: [
            {
              id: "local-2",
              erc8183JobId: "200",
              providerAddress: config.circleWalletAddress,
              priceAtomic: "3000000",
              description: "test job",
              status: "Open",
            },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          budgetAtomic: "3000000",
          provider: config.circleWalletAddress,
        });

      const worker = createProviderWorker(config, services as any, mcp as any, runtime as any);

      await worker.runOnce();

      expect(services.setBudget).toHaveBeenCalledTimes(1);
      const callArg = services.setBudget.mock.calls[0][0];
      // priceAtomic "3000000" → atomicToUsdc → "3" (decimal, no trailing zeros)
      expect(callArg.amount).toBe("3");
      expect(callArg.amount).not.toBe("3000000");
    });
  });

  describe("startup verification", () => {
    it("rejects non-provider role", async () => {
      const config = makeConfig({ defaultRole: "client" as any });
      const services = makeServices();
      const mcp = makeMcp();
      const runtime = makeRuntime();

      const worker = createProviderWorker(config, services as any, mcp as any, runtime as any);

      await expect(worker.runOnce()).rejects.toThrow("role=provider");
    });

    it("rejects missing MCP token", async () => {
      const config = makeConfig();
      const services = makeServices();
      const mcp = makeMcp();
      const runtime = makeRuntime();

      const originalEnv = process.env.ARCLAYER_MCP_TOKEN;
      delete process.env.ARCLAYER_MCP_TOKEN;

      try {
        const worker = createProviderWorker(config, services as any, mcp as any, runtime as any);
        await expect(worker.runOnce()).rejects.toThrow("ARCLAYER_MCP_TOKEN");
      } finally {
        if (originalEnv) process.env.ARCLAYER_MCP_TOKEN = originalEnv;
      }
    });

    it("rejects non-ARC-TESTNET chain", async () => {
      const config = makeConfig({ chain: "ETH-MAINNET" });
      const services = makeServices();
      const mcp = makeMcp();
      const runtime = makeRuntime();

      process.env.ARCLAYER_MCP_TOKEN = "test-token";

      const worker = createProviderWorker(config, services as any, mcp as any, runtime as any);
      await expect(worker.runOnce()).rejects.toThrow("ARC-TESTNET");
    });
  });

  describe("setBudget recovery reconciliation", () => {
    it("reconciles setBudget when on-chain budget is atomic and idempotencyKey has decimal", async () => {
      const config = makeConfig();
      const services = makeServices();
      const mcp = makeMcp();
      const runtime = makeRuntime();

      // Mock listReconcilableOperations to return a pending setBudget with decimal amount
      services.listReconcilableOperations = vi.fn().mockReturnValue([
        {
          operationId: "op-1",
          kind: "setBudget",
          idempotencyKey: "setBudget:100:1.00",
        },
      ]);

      // Mock MCP to return on-chain status with atomic budget
      mcp.callTool = vi.fn()
        // identity.get_agent_account (verifyIdentity)
        .mockResolvedValueOnce({ ok: true, tokenId: "42" })
        // jobs.get_onchain_status (verifyPostcondition)
        .mockResolvedValueOnce({
          ok: true,
          budgetAtomic: "1000000",
          provider: config.circleWalletAddress,
        })
        // provider.list_assigned_jobs_extended (pollFundedJobs — empty)
        .mockResolvedValueOnce({ jobs: [] })
        // provider.list_assigned_jobs_extended (pollOpenJobs — empty)
        .mockResolvedValueOnce({ jobs: [] });

      const worker = createProviderWorker(config, services as any, mcp as any, runtime as any);

      await worker.runOnce();

      // Should reconcile as confirmed (decimal 1.00 → atomic 1000000 matches)
      expect(services.reconcileOperation).toHaveBeenCalledWith(
        "op-1",
        "confirmed",
        expect.objectContaining({ txHash: undefined, errorMessage: undefined }),
      );
    });

    it("reconciles setBudget failure when on-chain budget mismatches", async () => {
      const config = makeConfig();
      const services = makeServices();
      const mcp = makeMcp();
      const runtime = makeRuntime();

      services.listReconcilableOperations = vi.fn().mockReturnValue([
        {
          operationId: "op-2",
          kind: "setBudget",
          idempotencyKey: "setBudget:100:1.00",
        },
      ]);

      mcp.callTool = vi.fn()
        .mockResolvedValueOnce({ ok: true, tokenId: "42" })
        // On-chain budget is 2000000, expected 1000000 (from 1.00)
        .mockResolvedValueOnce({
          ok: true,
          budgetAtomic: "2000000",
          provider: config.circleWalletAddress,
        })
        .mockResolvedValueOnce({ jobs: [] })
        .mockResolvedValueOnce({ jobs: [] });

      const worker = createProviderWorker(config, services as any, mcp as any, runtime as any);

      await worker.runOnce();

      // Should reconcile as failed (budget mismatch)
      expect(services.reconcileOperation).toHaveBeenCalledWith(
        "op-2",
        "failed",
        expect.objectContaining({
          errorMessage: expect.stringContaining("Budget mismatch"),
        }),
      );
    });
  });
});
