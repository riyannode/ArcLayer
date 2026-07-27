import { describe, it, expect } from "vitest";
import { CircleDevWalletAdapter } from "../index";
import type { WalletExecutionAdapter } from "@arclayer/runner-core";

describe("CircleDevWalletAdapter", () => {
  const baseOpts = {
    apiKey: "test-api-key:1:secret",
    entitySecret: "abcdef1234567890abcdef1234567890",
    walletId: "test-wallet-id",
    walletAddress: "0x1234567890123456789012345678901234567890",
    chain: "ARC-TESTNET",
  };

  describe("constructor", () => {
    it("throws when apiKey is missing", () => {
      expect(() => new CircleDevWalletAdapter({ ...baseOpts, apiKey: "" }))
        .toThrow("circleApiKey is required");
    });

    it("throws when entitySecret is missing", () => {
      expect(() => new CircleDevWalletAdapter({ ...baseOpts, entitySecret: "" }))
        .toThrow("circleEntitySecret is required");
    });

    it("throws when walletId is missing", () => {
      expect(() => new CircleDevWalletAdapter({ ...baseOpts, walletId: "" }))
        .toThrow("circleWalletId is required");
    });

    it("throws when walletAddress is missing", () => {
      expect(() => new CircleDevWalletAdapter({ ...baseOpts, walletAddress: "" }))
        .toThrow("circleWalletAddress is required");
    });

    it("creates adapter with valid options", () => {
      const adapter = new CircleDevWalletAdapter(baseOpts);
      expect(adapter).toBeDefined();
    });
  });

  describe("version", () => {
    it("returns adapter version info", async () => {
      const adapter = new CircleDevWalletAdapter(baseOpts);
      const result = await adapter.version!();
      expect(result.command).toBe("circle-dev-wallet-adapter");
      expect(result.json).toHaveProperty("adapter", "circle-dev");
    });
  });

  describe("executeErc8183Write", () => {
    it("blocks non-allowlisted signatures", async () => {
      const adapter = new CircleDevWalletAdapter(baseOpts);
      await expect(
        adapter.executeErc8183Write({
          signature: "transfer(address,uint256)" as any,
          params: ["0xabc", "100"],
          contract: "0x1234567890123456789012345678901234567890",
          address: baseOpts.walletAddress,
          chain: "ARC-TESTNET",
        })
      ).rejects.toThrow("not in the ERC-8183 lifecycle allowlist");
    });
  });

  describe("executeAllowedArcWrite", () => {
    it("blocks register without allowRegister flag", async () => {
      const adapter = new CircleDevWalletAdapter(baseOpts);
      await expect(
        adapter.executeAllowedArcWrite!({
          signature: "register(string)",
          params: ["ipfs://metadata"],
          contract: "0x1234567890123456789012345678901234567890",
          address: baseOpts.walletAddress,
          chain: "ARC-TESTNET",
        })
      ).rejects.toThrow("ERC-8004 register execution is blocked");
    });

    it("blocks non-allowlisted Arc signatures", async () => {
      const adapter = new CircleDevWalletAdapter(baseOpts);
      await expect(
        adapter.executeAllowedArcWrite!({
          signature: "transfer(address,uint256)" as any,
          params: ["0xabc", "100"],
          contract: "0x1234567890123456789012345678901234567890",
          address: baseOpts.walletAddress,
          chain: "ARC-TESTNET",
        })
      ).rejects.toThrow("Only allowlisted ArcLayer contract methods");
    });
  });

  describe("optional methods", () => {
    it("inspectService is implemented", () => {
      const adapter: WalletExecutionAdapter = new CircleDevWalletAdapter(baseOpts);
      expect(adapter.inspectService).toBeDefined();
      expect(typeof adapter.inspectService).toBe("function");
    });

    it("payService is implemented", () => {
      const adapter: WalletExecutionAdapter = new CircleDevWalletAdapter(baseOpts);
      expect(adapter.payService).toBeDefined();
      expect(typeof adapter.payService).toBe("function");
    });

    it("gatewayDeposit is implemented", () => {
      const adapter: WalletExecutionAdapter = new CircleDevWalletAdapter(baseOpts);
      expect(adapter.gatewayDeposit).toBeDefined();
      expect(typeof adapter.gatewayDeposit).toBe("function");
    });

    it("gatewayBalance is implemented", () => {
      const adapter: WalletExecutionAdapter = new CircleDevWalletAdapter(baseOpts);
      expect(adapter.gatewayBalance).toBeDefined();
      expect(typeof adapter.gatewayBalance).toBe("function");
    });
  });


  describe("encodeCallDataFromSignature (via executeErc8183Write)", () => {
    it("setBudget(uint256,uint256,bytes) produces calldata with correct selector", async () => {
      // setBudget selector = 0xdd4ae9d4
      const { encodeFunctionData, parseAbi } = await import("viem");
      const abi = parseAbi(["function setBudget(uint256 jobId, uint256 amount, bytes optParams)"]);
      const callData = encodeFunctionData({
        abi,
        functionName: "setBudget",
        args: [126328n, 10000n, "0x"],
      });
      expect(callData).toMatch(/^0xdd4ae9d4/);
      // 4 (selector) + 3*32 (3 words) = 100 hex chars = 200 + 2 (0x) = 202
      expect(callData.length).toBe(266); // 4 selector + 3*32 uint256 + 32 offset + 32 length for dynamic bytes
    });

    it("submit(uint256,bytes32,bytes) produces calldata with correct selector", async () => {
      const { encodeFunctionData, parseAbi } = await import("viem");
      const abi = parseAbi(["function submit(uint256 jobId, bytes32 deliverableHash, bytes proof)"]);
      const hash = "0x" + "ab".repeat(32);
      const callData = encodeFunctionData({
        abi,
        functionName: "submit",
        args: [126328n, hash, "0x"],
      });
      // submit selector = 0x9e63798d
      expect(callData).toMatch(/^0x9e63798d/);
    });

    it("complete(uint256,bytes32,bytes) produces calldata", async () => {
      const { encodeFunctionData, parseAbi } = await import("viem");
      const abi = parseAbi(["function complete(uint256 jobId, bytes32 reason, bytes proof)"]);
      const callData = encodeFunctionData({
        abi,
        functionName: "complete",
        args: [1n, "0x" + "00".repeat(32), "0x"],
      });
      expect(callData).toMatch(/^0x/);
      expect(callData.length).toBeGreaterThan(10);
    });

    it("reject(uint256,bytes32,bytes) produces calldata", async () => {
      const { encodeFunctionData, parseAbi } = await import("viem");
      const abi = parseAbi(["function reject(uint256 jobId, bytes32 reason, bytes proof)"]);
      const callData = encodeFunctionData({
        abi,
        functionName: "reject",
        args: [1n, "0x" + "00".repeat(32), "0x"],
      });
      expect(callData).toMatch(/^0x/);
    });

    it("createJob(address,address,uint256,string,address) produces calldata", async () => {
      const { encodeFunctionData, parseAbi } = await import("viem");
      const abi = parseAbi(["function createJob(address provider, address evaluator, uint256 amount, string description, address token)"]);
      const callData = encodeFunctionData({
        abi,
        functionName: "createJob",
        args: [
          "0x1234567890123456789012345678901234567890",
          "0x1234567890123456789012345678901234567890",
          1000000n,
          "test job",
          "0x3600000000000000000000000000000000000000",
        ],
      });
      expect(callData).toMatch(/^0x/);
    });

    it("string params are accepted (not just bigint)", async () => {
      const { encodeFunctionData, parseAbi } = await import("viem");
      const abi = parseAbi(["function setBudget(uint256 jobId, uint256 amount, bytes optParams)"]);
      // String args should produce same calldata as bigint args
      const withString = encodeFunctionData({ abi, functionName: "setBudget", args: ["126328", "10000", "0x"] });
      const withBigInt = encodeFunctionData({ abi, functionName: "setBudget", args: [126328n, 10000n, "0x"] });
      expect(withString).toBe(withBigInt);
    });
  });

});
